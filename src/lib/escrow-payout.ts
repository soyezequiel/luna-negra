import type { Bet, BetParticipant } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { fetchProfile } from "@/lib/nostr";
import { pubkeyFromNpub } from "@/lib/escrow";
import { recordOutflow } from "@/lib/ledger";
import { canPayout } from "@/lib/ledger-math";
import { msatToSats } from "@/lib/money";
import {
  lightningConfigured,
  payToLightningAddress,
} from "@/lib/lightning";
import { WITHDRAW_WINDOW_MS } from "@/lib/escrow-config";

/**
 * Cascada de destino (R5): lud16 configurado en Luna Negra (perfil) →
 * lud16 del perfil Nostr (kind:0). Si no hay → null (fallback a QR de retiro).
 *
 * Si el usuario eligió cobrar a su wallet NWC (`payoutMethod === "nwc"`),
 * devolvemos null a propósito: el secreto NWC vive sólo en su navegador, así que
 * forzamos `withdraw_pending` y el cliente reclama el premio por LNURL-withdraw.
 */
export async function resolveDestination(npub: string): Promise<string | null> {
  const user = await prisma.user
    .findUnique({ where: { npub }, select: { lud16: true, payoutMethod: true } })
    .catch(() => null);
  if (user?.payoutMethod === "nwc") return null;
  if (user?.lud16) return user.lud16;

  const pk = pubkeyFromNpub(npub);
  if (!pk) return null;
  const profile = await fetchProfile(pk).catch(() => null);
  return profile?.lud16 ?? null;
}

/**
 * Mueve plata a un participante (reembolso o payout). Idempotente vía ledger.
 * - registra el outflow (invariante anti-insolvencia),
 * - resuelve destino (lud16) y paga; si no hay destino → withdraw_pending (QR, M6),
 * - en dev sin NWC, simula el pago.
 */
export async function payParticipant(args: {
  bet: Bet;
  participant: BetParticipant;
  amountMsat: bigint;
  kind: "refund" | "payout";
}): Promise<void> {
  const { bet, participant, amountMsat, kind } = args;
  const idempotencyKey = `${kind}:${bet.id}:${participant.userId}`;

  const rec = await recordOutflow({
    betId: bet.id,
    userId: participant.userId,
    kind,
    amountMsat,
    idempotencyKey,
  });
  if (!rec.ok) return; // duplicate (ya procesado) o insolvent (no debería)

  const dest = await resolveDestination(participant.npub);

  const markPaid = async (preimage: string) => {
    await prisma.ledgerEntry.update({
      where: { idempotencyKey },
      data: { status: "settled", paymentHash: preimage },
    });
    await prisma.betParticipant.update({
      where: { id: participant.id },
      data: {
        payoutStatus: "paid",
        payoutMsat: amountMsat,
        payoutDestination: dest,
        settledAt: new Date(),
        ...(kind === "refund" ? { depositStatus: "refunded" } : {}),
      },
    });
  };
  const markFailed = async () => {
    await prisma.ledgerEntry.update({
      where: { idempotencyKey },
      data: { status: "failed" },
    });
    await prisma.betParticipant.update({
      where: { id: participant.id },
      data: { payoutStatus: "failed", payoutMsat: amountMsat },
    });
  };

  // Dev sin wallet: simular pago para poder probar el flujo.
  if (!lightningConfigured()) {
    await markPaid("dev-preimage");
    return;
  }

  if (!dest) {
    // Sin destino → retiro por QR (M6). El ledger queda pending (comprometido).
    await prisma.betParticipant.update({
      where: { id: participant.id },
      data: {
        payoutStatus: "withdraw_pending",
        payoutMsat: amountMsat,
        withdrawDeadline: new Date(Date.now() + WITHDRAW_WINDOW_MS),
      },
    });
    return;
  }

  try {
    const preimage = await payToLightningAddress(
      dest,
      Number(msatToSats(amountMsat)),
      `Luna Negra ${kind} ${bet.id}`,
    );
    await markPaid(preimage);
  } catch (err) {
    // Falló mover plata de una apuesta: alertar (queda "failed" para reintento).
    Sentry.captureException(err, {
      level: "error",
      tags: { flow: "escrow-payout", kind, betId: bet.id },
      extra: { participantId: participant.id, amountMsat: amountMsat.toString() },
    });
    await markFailed();
  }
}

/**
 * Reintenta un cobro/reembolso que quedó en `failed` (ej. el wallet del escrow
 * estaba offline al liquidar). `payParticipant` atrapa el error de pago y deja
 * `payoutStatus: "failed"` SIN lanzar, así que la apuesta se marca `settled` igual
 * y nada más lo reintenta: ni el reporte de resultado (idempotente, terminal) ni
 * el resto del tick. Esta función cierra ese hueco re-emitiendo el pago sobre el
 * asiento de ledger existente (no crea uno nuevo: `recordOutflow` lo rechazaría
 * por duplicado). Idempotente y seguro de re-ejecutar: si el pago no salió, los
 * fondos siguen en el pozo. La dispara `runTick`.
 *
 * Devuelve qué pasó, para contabilizar en el tick.
 */
export async function retryFailedPayout(
  participantId: string,
): Promise<"paid" | "withdraw_pending" | "failed" | "skipped"> {
  if (!lightningConfigured()) return "skipped";

  const part = await prisma.betParticipant.findUnique({
    where: { id: participantId },
    include: { bet: true },
  });
  if (!part || part.payoutStatus !== "failed" || !part.payoutMsat) return "skipped";

  // El asiento saliente fallido del participante (payout o refund según terminó
  // la apuesta). Lo ubicamos por la idempotencyKey canónica `${kind}:${betId}:${userId}`.
  const entry = await prisma.ledgerEntry.findFirst({
    where: {
      idempotencyKey: {
        in: [`payout:${part.betId}:${part.userId}`, `refund:${part.betId}:${part.userId}`],
      },
      status: "failed",
    },
  });
  if (!entry) return "skipped";
  const kind = entry.kind === "refund" ? "refund" : "payout";
  const amountMsat = entry.amountMsat;

  // Solvencia: `canPayout` ignora los asientos `failed`, así que esto valida que
  // haya saldo para re-emitir `amountMsat` sobre los movimientos vigentes.
  const entries = await prisma.ledgerEntry.findMany({
    where: { betId: part.betId },
    select: { kind: true, amountMsat: true, status: true },
  });
  if (!canPayout(entries, amountMsat)) return "skipped";

  const dest = await resolveDestination(part.npub);

  // Sin destino → el premio se cobra por QR (LNURL-withdraw). El asiento queda
  // `pending` (comprometido) hasta que se reclame o expire (forfeit en el tick).
  if (!dest) {
    await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { status: "pending" } });
    await prisma.betParticipant.update({
      where: { id: part.id },
      data: {
        payoutStatus: "withdraw_pending",
        withdrawDeadline: new Date(Date.now() + WITHDRAW_WINDOW_MS),
      },
    });
    return "withdraw_pending";
  }

  try {
    const preimage = await payToLightningAddress(
      dest,
      Number(msatToSats(amountMsat)),
      `Luna Negra ${kind} ${part.betId} (reintento)`,
    );
    await prisma.ledgerEntry.update({
      where: { id: entry.id },
      data: { status: "settled", paymentHash: preimage },
    });
    await prisma.betParticipant.update({
      where: { id: part.id },
      data: {
        payoutStatus: "paid",
        payoutDestination: dest,
        settledAt: new Date(),
        ...(kind === "refund" ? { depositStatus: "refunded" } : {}),
      },
    });
    return "paid";
  } catch (err) {
    // Sigue fallando (wallet aún caído, etc.): queda `failed` para el próximo tick.
    Sentry.captureException(err, {
      level: "error",
      tags: { flow: "escrow-payout-retry", kind, betId: part.betId },
      extra: { participantId: part.id, amountMsat: amountMsat.toString() },
    });
    return "failed";
  }
}
