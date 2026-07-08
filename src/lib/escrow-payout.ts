import { nip19 } from "nostr-tools";
import type { Bet, BetParticipant, Provider, User } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { recordOutflow } from "@/lib/ledger";
import { canPayout } from "@/lib/ledger-math";
import { msatToSats } from "@/lib/money";
import {
  lightningConfigured,
  payToLightningAddress,
} from "@/lib/lightning";
import { WITHDRAW_WINDOW_MS } from "@/lib/escrow-config";
import { resolveDestination } from "@/lib/payout-destinations";

// La cascada de destino (resolveDestination / resolveZapDestination /
// prewarmPayoutDestinations) vive en payout-destinations.ts, módulo NEUTRAL
// compartido con v2: así retirar este módulo v1 no rompe el motor v2. Se
// re-exporta para los importadores v1 existentes.
export {
  prewarmPayoutDestinations,
  resolveDestination,
  resolveZapDestination,
} from "@/lib/payout-destinations";

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
 * Paga el CORTE DEL DEV (proveedor) de una apuesta liquidada. Sale del pozo como
 * un asiento `dev_fee` (idempotente vía ledger) y se envía a la dirección de cobro
 * del proveedor. Espeja a `payParticipant` pero el destinatario es el dueño del
 * juego, no un jugador:
 * - destino: `provider.lightningAddress` (la misma que cobra las ventas) y, si
 *   falta, la cascada lud16 del dueño (`resolveDestination`).
 * - sin destino → el asiento queda `pending` (deuda registrada con el dev; la casa
 *   la retiene). NO bloquea el pago al ganador ni lanza.
 * - en dev sin wallet, se simula el pago.
 */
export async function payProviderFee(args: {
  bet: Bet & { provider: Provider & { owner: User } };
  amountMsat: bigint;
}): Promise<void> {
  const { bet, amountMsat } = args;
  if (amountMsat <= 0n) return;
  // Lightning no mueve sub-1-sat: si el corte del dev redondea a <1 sat (apuestas de
  // stake chico), no se puede pagar ni por zap ni por LNURL ("Invalid amount"). Lo
  // retiene la casa junto con su comisión, sin asiento (mismo criterio que el dust).
  if (amountMsat < 1000n) return;
  const owner = bet.provider.owner;
  const idempotencyKey = `dev_fee:${bet.id}`;

  const rec = await recordOutflow({
    betId: bet.id,
    userId: owner.id,
    kind: "dev_fee",
    amountMsat,
    idempotencyKey,
  });
  if (!rec.ok) return; // duplicado (ya procesado) o insolvente (no debería)

  // Destino: la dirección de cobro del proveedor, o la cascada lud16 del dueño.
  const dest =
    bet.provider.lightningAddress ??
    (await resolveDestination(nip19.npubEncode(owner.pubkey)));

  const markPaid = async (preimage: string) => {
    await prisma.ledgerEntry.update({
      where: { idempotencyKey },
      data: { status: "settled", paymentHash: preimage },
    });
  };

  // Dev sin wallet: simular el pago para poder probar el flujo.
  if (!lightningConfigured()) {
    await markPaid("dev-preimage");
    return;
  }

  // Sin destino → el asiento queda `pending` (deuda con el dev, la casa la retiene).
  if (!dest) return;

  try {
    const preimage = await payToLightningAddress(
      dest,
      Number(msatToSats(amountMsat)),
      `Luna Negra dev_fee ${bet.id}`,
    );
    await markPaid(preimage);
  } catch (err) {
    // Falló pagar el corte del dev: alertar y dejar el asiento `failed`. No afecta
    // al ganador (su payout es un asiento aparte ya emitido).
    Sentry.captureException(err, {
      level: "error",
      tags: { flow: "escrow-payout", kind: "dev_fee", betId: bet.id },
      extra: { amountMsat: amountMsat.toString() },
    });
    await prisma.ledgerEntry.update({
      where: { idempotencyKey },
      data: { status: "failed" },
    });
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
