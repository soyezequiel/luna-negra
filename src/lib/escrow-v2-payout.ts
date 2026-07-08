import { nip19 } from "nostr-tools";
import type { ZapBet, ZapBetParticipant, Provider, User } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { resolveDestination, resolveZapDestination } from "@/lib/escrow-payout";
import { recordOutflowV2 } from "@/lib/ledger-v2";
import { canPayout } from "@/lib/ledger-math";
import { lightningConfigured } from "@/lib/lightning";
import { sendZapPayout } from "@/lib/zap-payout";
import { WITHDRAW_WINDOW_MS } from "@/lib/escrow-v2-config";
import { notifyOperationalError } from "@/lib/discord";

// Payouts de apuestas v2: Luna Negra ZAPEA al ganador / refund / dev fee (o cae a
// LNURL / QR de retiro). Espejo de escrow-payout.ts sobre el ledger v2, con la
// misma cascada de destino (`resolveDestination`, reutilizada) e idempotencia por
// ledger. La diferencia es el riel: `sendZapPayout` en vez de `payToLightningAddress`.

type MarkPaid = { preimage: string; payoutKind: "zap" | "lnurl"; zapRequestId?: string };

/**
 * Pubkey REAL del jugador de un asiento NGE (la que manda el juego), leída del
 * seatsMeta del contrato por el npub del invitado. En NGE cada asiento envuelve al
 * jugador en una cuenta invitada efímera (para el depósito custodial), pero el PAYOUT
 * debe ir al jugador real —su lud16 de perfil— para que el premio le llegue solo y no
 * quede varado en el invitado. Null si no es NGE o el asiento es anónimo (sin pubkey):
 * ahí se cobra por QR de retiro, como antes.
 */
export function ngeSeatRealPubkey(bet: Pick<ZapBet, "metadataJson">, guestNpub: string): string | null {
  try {
    const meta = JSON.parse(bet.metadataJson ?? "{}") as {
      nge?: { seats?: Array<{ npub?: string; pubkey?: string }> };
    };
    const seat = meta.nge?.seats?.find((s) => s.npub === guestNpub);
    const pk = seat?.pubkey;
    return typeof pk === "string" && /^[0-9a-f]{64}$/.test(pk) ? pk : null;
  } catch {
    return null;
  }
}

/**
 * Mueve plata a un participante (payout o refund) como profile-zap.
 * Idempotente vía ledger; sin destino → withdraw_pending (QR); dev sin NWC simula.
 */
export async function payParticipantV2(args: {
  bet: ZapBet;
  participant: ZapBetParticipant;
  amountMsat: bigint;
  kind: "refund" | "payout";
}): Promise<void> {
  const { bet, participant, amountMsat, kind } = args;
  const idempotencyKey = `${kind}:${bet.id}:${participant.userId}`;

  const rec = await recordOutflowV2({
    betId: bet.id,
    userId: participant.userId,
    kind,
    amountMsat,
    idempotencyKey,
  });
  if (!rec.ok) {
    if (rec.reason === "insolvent") {
      await notifyOperationalError({
        source: "escrow-v2-insolvent-payout",
        error: new Error("El ledger rechazó el payout por fondos insuficientes"),
        fingerprint: `escrow-v2-insolvent:${idempotencyKey}`,
        cooldownMs: 60 * 60_000,
        context: { betId: bet.id, participantId: participant.id, kind, amountMsat },
      });
    }
    return;
  }

  // NGE: pagamos al JUGADOR real (su pubkey vino en el asiento), no al invitado
  // efímero. Así el premio le llega solo como zap social a su perfil. Si el asiento es
  // anónimo (sin pubkey real) → resolvemos contra el invitado (sin lud16 → QR de retiro).
  const realPubkey = ngeSeatRealPubkey(bet, participant.npub);
  const recipientPubkey = realPubkey ?? participant.pubkey;
  const dest = await resolveZapDestination(
    realPubkey ? nip19.npubEncode(realPubkey) : participant.npub,
  );

  const markPaid = async (res: MarkPaid) => {
    await prisma.zapLedgerEntry.update({
      where: { idempotencyKey },
      data: { status: "settled", paymentHash: res.preimage, zapRequestId: res.zapRequestId ?? null },
    });
    await prisma.zapBetParticipant.update({
      where: { id: participant.id },
      data: {
        payoutStatus: "paid",
        payoutMsat: amountMsat,
        payoutDestination: dest,
        payoutKind: res.payoutKind,
        payoutZapRequestId: res.zapRequestId ?? null,
        settledAt: new Date(),
        ...(kind === "refund" ? { depositStatus: "refunded" } : {}),
      },
    });
  };
  const markFailed = async () => {
    await prisma.zapLedgerEntry.update({ where: { idempotencyKey }, data: { status: "failed" } });
    await prisma.zapBetParticipant.update({
      where: { id: participant.id },
      data: { payoutStatus: "failed", payoutMsat: amountMsat },
    });
  };
  const markWithdraw = async () => {
    await prisma.zapBetParticipant.update({
      where: { id: participant.id },
      data: {
        payoutStatus: "withdraw_pending",
        payoutMsat: amountMsat,
        payoutKind: "withdraw",
        withdrawDeadline: new Date(Date.now() + WITHDRAW_WINDOW_MS),
      },
    });
  };

  // Dev sin wallet: simular pago (como v1, antes de resolver destino).
  if (!lightningConfigured()) {
    await markPaid({ preimage: "dev-preimage", payoutKind: "lnurl" });
    return;
  }
  // Sin destino → retiro por QR. El ledger queda pending (comprometido).
  if (!dest) {
    await markWithdraw();
    return;
  }

  // El premio del ganador se zapea a SU comentario de participación (si se publicó);
  // el reembolso va al post del contrato. Sin comentario, el premio cae al post.
  const payoutAnchor =
    kind === "payout" ? (participant.commentEventId ?? bet.anchorEventId) : bet.anchorEventId;
  const res = await sendZapPayout({
    anchorEventId: payoutAnchor,
    recipientPubkey,
    address: dest,
    amountMsat,
    comment: `Luna Negra ${kind} ${bet.id}`,
  });
  if (res.kind === "zap") {
    await markPaid({ preimage: res.preimage, payoutKind: "zap", zapRequestId: res.zapRequestId });
  } else if (res.kind === "lnurl") {
    await markPaid({ preimage: res.preimage, payoutKind: "lnurl" });
  } else if (res.kind === "withdraw") {
    await markWithdraw();
  } else {
    Sentry.captureException(new Error(res.error), {
      level: "error",
      tags: { flow: "escrow-v2-payout", kind, betId: bet.id },
      extra: { participantId: participant.id, amountMsat: amountMsat.toString() },
    });
    await markFailed();
  }
}

/**
 * Paga el CORTE DEL DEV (proveedor) como profile-zap. Sale del pozo como asiento
 * `dev_fee`. Sin destino → el asiento queda `pending` (deuda con el dev; la casa la
 * retiene). NO bloquea el payout del ganador ni lanza. Espejo de payProviderFee.
 */
export async function payProviderFeeV2(args: {
  bet: ZapBet & { provider: Provider & { owner: User } };
  amountMsat: bigint;
}): Promise<void> {
  const { bet, amountMsat } = args;
  if (amountMsat <= 0n) return;
  // Lightning no mueve sub-1-sat: si el corte del dev redondea a <1 sat (típico en
  // apuestas de stake chico, ej. 5% de 18 sats = 0,9 sat), NO se puede pagar ni por
  // zap (mín 1000 msat) ni por LNURL (WoS solo emite sats enteros → "Invalid amount").
  // Lo retiene la casa junto con su comisión, sin asiento ni alerta (mismo criterio
  // que el `dust` del reparto entre ganadores).
  if (amountMsat < 1000n) return;
  const owner = bet.provider.owner;
  const idempotencyKey = `dev_fee:${bet.id}`;

  const rec = await recordOutflowV2({
    betId: bet.id,
    userId: owner.id,
    kind: "dev_fee",
    amountMsat,
    idempotencyKey,
  });
  if (!rec.ok) {
    if (rec.reason === "insolvent") {
      await notifyOperationalError({
        source: "escrow-v2-insolvent-dev-fee",
        error: new Error("El ledger rechazó el corte del proveedor por fondos insuficientes"),
        fingerprint: `escrow-v2-insolvent:${idempotencyKey}`,
        cooldownMs: 60 * 60_000,
        context: { betId: bet.id, providerId: bet.providerId, amountMsat },
      });
    }
    return;
  }

  const dest =
    bet.provider.lightningAddress ??
    (await resolveDestination(nip19.npubEncode(owner.pubkey)));

  const markPaid = async (preimage: string, zapRequestId?: string) => {
    await prisma.zapLedgerEntry.update({
      where: { idempotencyKey },
      data: { status: "settled", paymentHash: preimage, zapRequestId: zapRequestId ?? null },
    });
  };

  if (!lightningConfigured()) {
    await markPaid("dev-preimage");
    return;
  }
  if (!dest) {
    await notifyOperationalError({
      source: "escrow-v2-dev-fee-destination",
      error: new Error("El proveedor no tiene una Lightning Address para cobrar su corte"),
      fingerprint: `escrow-v2-dev-fee-destination:${bet.providerId}`,
      cooldownMs: 60 * 60_000,
      context: { betId: bet.id, providerId: bet.providerId, amountMsat },
    });
    return; // asiento pending = deuda con el dev
  }

  const res = await sendZapPayout({
    anchorEventId: bet.anchorEventId,
    recipientPubkey: owner.pubkey,
    address: dest,
    amountMsat,
    comment: `Luna Negra dev_fee ${bet.id}`,
  });
  if (res.kind === "zap") await markPaid(res.preimage, res.zapRequestId);
  else if (res.kind === "lnurl") await markPaid(res.preimage);
  else {
    // withdraw (dest presente ⇒ no debería) o failed: dejar el asiento failed.
    await prisma.zapLedgerEntry.update({ where: { idempotencyKey }, data: { status: "failed" } });
  }
}

/**
 * Corte de la CASA (Luna Negra) = la DIFERENCIA que queda en el pozo tras pagar al
 * ganador y al dev. NO genera un movimiento saliente: Luna Negra es la custodia del
 * pozo, así que su parte simplemente se queda en su propio NWC. Solo registra el
 * asiento `fee` (settled) para que el ledger cuadre (pozo = fee + dev + payout) y la
 * nota de liquidación lo muestre. Minimiza los pagos salientes a lo indispensable:
 * ganador y dev. (v1 ya hacía esto; ahora v2 también, sin la wallet de fee externa.)
 */
export async function payHouseFeeV2(args: {
  bet: ZapBet;
  amountMsat: bigint;
}): Promise<void> {
  const { bet, amountMsat } = args;
  if (amountMsat <= 0n) return;
  const idempotencyKey = `fee:${bet.id}`;

  const rec = await recordOutflowV2({
    betId: bet.id,
    userId: null,
    kind: "fee",
    amountMsat,
    idempotencyKey,
  });
  if (!rec.ok) {
    if (rec.reason === "insolvent") {
      await notifyOperationalError({
        source: "escrow-v2-insolvent-house-fee",
        error: new Error("El ledger rechazó la comisión de la casa por fondos insuficientes"),
        fingerprint: `escrow-v2-insolvent:${idempotencyKey}`,
        cooldownMs: 60 * 60_000,
        context: { betId: bet.id, amountMsat },
      });
    }
    return;
  }

  // Retenido en el NWC de la casa (sin zap saliente): el asiento queda settled.
  await prisma.zapLedgerEntry.update({
    where: { idempotencyKey },
    data: { status: "settled" },
  });
}

/**
 * Reintenta un cobro/reembolso v2 que quedó `failed`. Re-emite sobre el asiento de
 * ledger existente (idempotencyKey canónica); sin destino → withdraw_pending.
 * Espejo de retryFailedPayout. Devuelve qué pasó (para contabilizar en el tick).
 */
export async function retryFailedPayoutV2(
  participantId: string,
): Promise<"paid" | "withdraw_pending" | "failed" | "skipped"> {
  if (!lightningConfigured()) return "skipped";

  const part = await prisma.zapBetParticipant.findUnique({
    where: { id: participantId },
    include: { bet: true },
  });
  if (!part || part.payoutStatus !== "failed" || !part.payoutMsat) return "skipped";

  const entry = await prisma.zapLedgerEntry.findFirst({
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

  const entries = await prisma.zapLedgerEntry.findMany({
    where: { betId: part.betId },
    select: { kind: true, amountMsat: true, status: true },
  });
  if (!canPayout(entries, amountMsat)) {
    await notifyOperationalError({
      source: "escrow-v2-insolvent-retry",
      error: new Error("El ledger no permite reintentar el payout por fondos insuficientes"),
      fingerprint: `escrow-v2-insolvent-retry:${entry.id}`,
      cooldownMs: 60 * 60_000,
      context: { betId: part.betId, participantId: part.id, amountMsat },
    });
    return "skipped";
  }

  const dest = await resolveZapDestination(part.npub);
  if (!dest) {
    await prisma.zapLedgerEntry.update({ where: { id: entry.id }, data: { status: "pending" } });
    await prisma.zapBetParticipant.update({
      where: { id: part.id },
      data: {
        payoutStatus: "withdraw_pending",
        payoutKind: "withdraw",
        withdrawDeadline: new Date(Date.now() + WITHDRAW_WINDOW_MS),
      },
    });
    return "withdraw_pending";
  }

  const retryAnchor =
    kind === "payout" ? (part.commentEventId ?? part.bet.anchorEventId) : part.bet.anchorEventId;
  const res = await sendZapPayout({
    anchorEventId: retryAnchor,
    recipientPubkey: part.pubkey,
    address: dest,
    amountMsat,
    comment: `Luna Negra ${kind} ${part.betId} (reintento)`,
  });
  if (res.kind === "zap" || res.kind === "lnurl") {
    await prisma.zapLedgerEntry.update({
      where: { id: entry.id },
      data: {
        status: "settled",
        paymentHash: res.preimage,
        zapRequestId: res.kind === "zap" ? res.zapRequestId : null,
      },
    });
    await prisma.zapBetParticipant.update({
      where: { id: part.id },
      data: {
        payoutStatus: "paid",
        payoutDestination: dest,
        payoutKind: res.kind,
        payoutZapRequestId: res.kind === "zap" ? res.zapRequestId : null,
        settledAt: new Date(),
        ...(kind === "refund" ? { depositStatus: "refunded" } : {}),
      },
    });
    return "paid";
  }
  return "failed";
}
