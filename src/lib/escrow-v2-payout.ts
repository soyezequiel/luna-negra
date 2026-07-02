import { nip19 } from "nostr-tools";
import type { ZapBet, ZapBetParticipant, Provider, User } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { resolveDestination } from "@/lib/escrow-payout";
import { recordOutflowV2 } from "@/lib/ledger-v2";
import { canPayout } from "@/lib/ledger-math";
import { lightningConfigured } from "@/lib/lightning";
import { getStorePubkey } from "@/lib/nostr-server";
import { sendZapPayout } from "@/lib/zap-payout";
import { LUNA_FEE_LUD16, WITHDRAW_WINDOW_MS } from "@/lib/escrow-v2-config";

// Payouts de apuestas v2: Luna Negra ZAPEA al ganador / refund / dev fee (o cae a
// LNURL / QR de retiro). Espejo de escrow-payout.ts sobre el ledger v2, con la
// misma cascada de destino (`resolveDestination`, reutilizada) e idempotencia por
// ledger. La diferencia es el riel: `sendZapPayout` en vez de `payToLightningAddress`.

type MarkPaid = { preimage: string; payoutKind: "zap" | "lnurl"; zapRequestId?: string };

/**
 * Mueve plata a un participante (payout o refund) como zap anclado al contrato.
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
  if (!rec.ok) return; // duplicate (ya procesado) o insolvent (no debería)

  const dest = await resolveDestination(participant.npub);

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

  const res = await sendZapPayout({
    anchorEventId: bet.anchorEventId,
    recipientPubkey: participant.pubkey,
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
 * Paga el CORTE DEL DEV (proveedor) como zap anclado. Sale del pozo como asiento
 * `dev_fee`. Sin destino → el asiento queda `pending` (deuda con el dev; la casa la
 * retiene). NO bloquea el payout del ganador ni lanza. Espejo de payProviderFee.
 */
export async function payProviderFeeV2(args: {
  bet: ZapBet & { provider: Provider & { owner: User } };
  amountMsat: bigint;
}): Promise<void> {
  const { bet, amountMsat } = args;
  if (amountMsat <= 0n) return;
  const owner = bet.provider.owner;
  const idempotencyKey = `dev_fee:${bet.id}`;

  const rec = await recordOutflowV2({
    betId: bet.id,
    userId: owner.id,
    kind: "dev_fee",
    amountMsat,
    idempotencyKey,
  });
  if (!rec.ok) return;

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
  if (!dest) return; // asiento pending = deuda con el dev

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
 * Corte de la CASA (Luna Negra). Nunca self-payment al NWC del escrow: si
 * `LUNA_FEE_LUD16` apunta a otro wallet, el fee sale como zap real (receptor = la
 * tienda, destino = ese wallet); si no, queda como asiento `fee` settled en el
 * ledger (la casa lo retiene en su NWC), igual que v1. En ambos casos la nota de
 * liquidación lo registra públicamente.
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
  if (!rec.ok) return;

  const storePubkey = getStorePubkey();
  // Zap real solo si hay un wallet de fee DISTINTO configurado y NWC disponible.
  if (LUNA_FEE_LUD16 && storePubkey && lightningConfigured()) {
    const res = await sendZapPayout({
      anchorEventId: bet.anchorEventId,
      recipientPubkey: storePubkey,
      address: LUNA_FEE_LUD16,
      amountMsat,
      comment: `Luna Negra fee ${bet.id}`,
    });
    if (res.kind === "zap" || res.kind === "lnurl") {
      await prisma.zapLedgerEntry.update({
        where: { idempotencyKey },
        data: {
          status: "settled",
          paymentHash: res.kind === "lnurl" ? res.preimage : res.preimage,
          zapRequestId: res.kind === "zap" ? res.zapRequestId : null,
        },
      });
      return;
    }
    // Falló mover el fee al wallet externo: lo retiene la casa (asiento settled).
  }
  // Sin wallet de fee externo: el fee queda en el NWC de la casa (asiento settled).
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
  if (!canPayout(entries, amountMsat)) return "skipped";

  const dest = await resolveDestination(part.npub);
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

  const res = await sendZapPayout({
    anchorEventId: part.bet.anchorEventId,
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
