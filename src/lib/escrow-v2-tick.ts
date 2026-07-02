import type { Event } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { isInvoicePaid, lightningConfigured } from "@/lib/lightning";
import {
  settleDepositV2,
  promoteIfAllPaidV2,
} from "@/lib/zap-bet";
import { payParticipantV2, retryFailedPayoutV2 } from "@/lib/escrow-v2-payout";
import { republishEvent } from "@/lib/nostr-server";
import {
  emitBetExpiredV2,
  emitBetRefundedV2,
} from "@/lib/webhooks";

/**
 * Ciclo de vida de las apuestas v2 (in-process, cada ~1 min). Espejo de runTick:
 * A) detectar depósitos pagados (publica el 9735); B) promover a ready; C) timeout
 * de depósito → refund por zap → cancelled_incomplete; D) timeout de resolución →
 * refund total por zap → refunded_timeout; E) forfeit de retiros vencidos; F) retry
 * de payouts failed; G) retry de publicación de recibos 9735 propios. Idempotente:
 * claim optimista de estado + idempotencyKey en el ledger.
 */
export async function runTickV2(): Promise<{
  deposits: number;
  ready: number;
  refunded: number;
  forfeited: number;
  retried: number;
  receiptsRepublished: number;
}> {
  const now = new Date();
  let deposits = 0;
  let ready = 0;
  let refunded = 0;
  let forfeited = 0;
  let retried = 0;
  let receiptsRepublished = 0;

  // A) Detectar depósitos pagados (lookup_invoice) en apuestas pending_deposits.
  if (lightningConfigured()) {
    const pend = await prisma.zapBet.findMany({
      where: { status: "pending_deposits" },
      include: { participants: true },
    });
    for (const bet of pend) {
      for (const p of bet.participants) {
        if (
          p.depositStatus === "pending" &&
          p.depositPaymentHash &&
          !p.depositPaymentHash.startsWith("dev-")
        ) {
          const paid = await isInvoicePaid(p.depositPaymentHash).catch(() => false);
          if (paid) {
            await settleDepositV2(bet, p, now);
            deposits++;
          }
        }
      }
    }
  }

  // B) pending_deposits con todos pagos → ready (claim optimista).
  const maybeReady = await prisma.zapBet.findMany({
    where: { status: "pending_deposits" },
    select: { id: true },
  });
  for (const { id } of maybeReady) {
    if (await promoteIfAllPaidV2(id, now)) ready++;
  }

  // C) Timeout de depósito (incompleto) → reembolso por zap a los que pagaron.
  const expiredDep = await prisma.zapBet.findMany({
    where: { status: "pending_deposits", depositDeadline: { lt: now } },
    include: { participants: true },
  });
  for (const bet of expiredDep) {
    const claimed = await prisma.zapBet.updateMany({
      where: { id: bet.id, status: "pending_deposits" },
      data: { status: "refunding" },
    });
    if (claimed.count !== 1) continue;
    for (const p of bet.participants.filter((x) => x.depositStatus === "paid")) {
      await payParticipantV2({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
      refunded++;
    }
    await prisma.zapBet.update({
      where: { id: bet.id },
      data: { status: "cancelled_incomplete" },
    });
    await emitBetExpiredV2(bet.id);
    await emitBetRefundedV2(bet.id, "expired");
  }

  // D) Timeout de resolución (sin resultado) → reembolso total por zap.
  const expiredRes = await prisma.zapBet.findMany({
    where: { status: "ready", resolveDeadline: { lt: now } },
    include: { participants: true },
  });
  for (const bet of expiredRes) {
    const claimed = await prisma.zapBet.updateMany({
      where: { id: bet.id, status: "ready" },
      data: { status: "refunding" },
    });
    if (claimed.count !== 1) continue;
    for (const p of bet.participants) {
      await payParticipantV2({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
      refunded++;
    }
    await prisma.zapBet.update({
      where: { id: bet.id },
      data: { status: "refunded_timeout" },
    });
    await emitBetRefundedV2(bet.id, "resolve_timeout");
  }

  // E) Forfeit: retiros (QR) no reclamados pasada la ventana.
  const expiredWithdraw = await prisma.zapBetParticipant.findMany({
    where: { payoutStatus: "withdraw_pending", withdrawDeadline: { lt: now } },
  });
  for (const p of expiredWithdraw) {
    await prisma.zapBetParticipant.update({
      where: { id: p.id },
      data: { payoutStatus: "forfeited" },
    });
    await prisma.zapLedgerEntry.updateMany({
      where: {
        betId: p.betId,
        userId: p.userId,
        status: "pending",
        kind: { in: ["payout", "refund"] },
      },
      data: { status: "failed" },
    });
    forfeited++;
  }

  // F) Reintentar cobros/reembolsos que quedaron `failed`.
  if (lightningConfigured()) {
    const failedPayouts = await prisma.zapBetParticipant.findMany({
      where: { payoutStatus: "failed" },
      select: { id: true },
    });
    for (const { id } of failedPayouts) {
      const res = await retryFailedPayoutV2(id).catch(() => "failed" as const);
      if (res === "paid" || res === "withdraw_pending") retried++;
    }
  }

  // G) Reintentar la publicación de recibos 9735 propios que ningún relay aceptó.
  const pendingReceipts = await prisma.zapBetParticipant.findMany({
    where: { depositStatus: "paid", depositReceiptOk: false, depositReceiptJson: { not: null } },
    select: { id: true, depositReceiptJson: true },
  });
  for (const p of pendingReceipts) {
    if (!p.depositReceiptJson) continue;
    try {
      const ev = JSON.parse(p.depositReceiptJson) as Event;
      const accepted = await republishEvent(ev);
      if (accepted > 0) {
        await prisma.zapBetParticipant.update({
          where: { id: p.id },
          data: { depositReceiptOk: true },
        });
        receiptsRepublished++;
      }
    } catch {
      /* recibo corrupto en DB → se ignora */
    }
  }

  return { deposits, ready, refunded, forfeited, retried, receiptsRepublished };
}
