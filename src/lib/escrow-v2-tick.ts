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
import { publishNgpBetState } from "@/lib/ngp-bet-state";
import { notifyNgeBetUpdated } from "@/lib/nge-notify";
import { runNgeDeferredSettlements } from "@/lib/nge-settle";
import { notifyOperationalError } from "@/lib/discord";

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
  commentsRepublished: number;
}> {
  const now = new Date();
  let deposits = 0;
  let ready = 0;
  let refunded = 0;
  let forfeited = 0;
  let retried = 0;
  let receiptsRepublished = 0;
  let commentsRepublished = 0;

  // A) Detectar depósitos pagados (lookup_invoice) en apuestas pending_deposits.
  //    EN PARALELO: cada lookup son cientos de ms contra el nodo; en serie el
  //    barrido escalaba con (apuestas × asientos) y demoraba todo lo demás.
  //    Cada chequeo es independiente (filas distintas; settleDepositV2 hace
  //    claim atómico), así que el lote entero puede volar junto.
  if (lightningConfigured()) {
    const pend = await prisma.zapBet.findMany({
      where: { status: "pending_deposits" },
      include: { participants: true },
    });
    const due = pend.flatMap((bet) =>
      bet.participants
        .filter(
          (p) =>
            p.depositStatus === "pending" &&
            p.depositPaymentHash &&
            !p.depositPaymentHash.startsWith("dev-"),
        )
        .map((p) => ({ bet, p })),
    );
    const settled = await Promise.all(
      due.map(async ({ bet, p }) => {
        const paid = await isInvoicePaid(p.depositPaymentHash as string).catch(async (error) => {
          await notifyOperationalError({
            source: "zap-deposit-invoice-lookup",
            error,
            fingerprint: `zap-deposit-invoice-lookup:${p.depositPaymentHash}`,
            cooldownMs: 10 * 60_000,
            context: { betId: bet.id, participantId: p.id },
          });
          return false;
        });
        if (!paid) return false;
        await settleDepositV2(bet, p, now, "tick");
        return true;
      }),
    );
    deposits += settled.filter(Boolean).length;
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
    // Estado NGP: `expired` (fire-and-forget; no frena el barrido del tick).
    void publishNgpBetState(bet.id);
    void notifyNgeBetUpdated(bet.id);
  }

  // C.5) Liquidaciones NGE diferidas vencidas (ventana de disputa, spec §7.1).
  await runNgeDeferredSettlements();

  // D) Timeout de resolución (sin resultado) → reembolso total por zap.
  //    EXCLUYE apuestas con resultado fijado esperando su ventana de disputa
  //    (pendingWinnersJson): esas ya tienen destino y las ejecuta C.5.
  const expiredRes = await prisma.zapBet.findMany({
    where: { status: "ready", resolveDeadline: { lt: now }, pendingWinnersJson: null },
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
    // Estado NGP: `void` por timeout de resolución (fire-and-forget).
    void publishNgpBetState(bet.id);
    void notifyNgeBetUpdated(bet.id);
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
      const res = await retryFailedPayoutV2(id).catch(async (error) => {
        await notifyOperationalError({
          source: "zap-payout-retry",
          error,
          fingerprint: `zap-payout-retry:${id}`,
          cooldownMs: 10 * 60_000,
          context: { participantId: id },
        });
        return "failed" as const;
      });
      if (res === "paid" || res === "withdraw_pending") retried++;
    }
  }

  // G) Reintentar la publicación de recibos 9735 propios que ningún relay aceptó.
  const pendingReceipts = await prisma.zapBetParticipant.findMany({
    where: { depositStatus: "paid", depositReceiptOk: false, depositReceiptJson: { not: null } },
    select: { id: true, betId: true, depositReceiptJson: true },
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
      } else {
        await notifyOperationalError({
          source: "zap-deposit-receipt-relays",
          error: new Error("Ningún relay aceptó el recibo kind:9735 del depósito"),
          fingerprint: `zap-deposit-receipt-relays:${p.id}`,
          cooldownMs: 30 * 60_000,
          context: { betId: p.betId, participantId: p.id, receiptId: ev.id },
        });
      }
    } catch (error) {
      await notifyOperationalError({
        source: "zap-deposit-receipt-retry",
        error,
        fingerprint: `zap-deposit-receipt-retry:${p.id}`,
        cooldownMs: 30 * 60_000,
        context: { betId: p.betId, participantId: p.id },
      });
    }
  }

  // H) Reintentar la publicación de comentarios de participación que ningún relay
  //    aceptó (para que el payout del ganador tenga a qué anclar el zap).
  const pendingComments = await prisma.zapBetParticipant.findMany({
    where: { depositStatus: "paid", commentEventOk: false, commentEventJson: { not: null } },
    select: { id: true, betId: true, commentEventJson: true },
  });
  for (const p of pendingComments) {
    if (!p.commentEventJson) continue;
    try {
      const ev = JSON.parse(p.commentEventJson) as Event;
      const accepted = await republishEvent(ev);
      if (accepted > 0) {
        await prisma.zapBetParticipant.update({
          where: { id: p.id },
          data: { commentEventId: ev.id, commentEventOk: true },
        });
        commentsRepublished++;
      }
    } catch (error) {
      await notifyOperationalError({
        source: "zap-participation-comment-retry",
        error,
        fingerprint: `zap-participation-comment-retry:${p.id}`,
        cooldownMs: 30 * 60_000,
        context: { betId: p.betId, participantId: p.id },
      });
    }
  }

  return {
    deposits,
    ready,
    refunded,
    forfeited,
    retried,
    receiptsRepublished,
    commentsRepublished,
  };
}
