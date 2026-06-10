import { prisma } from "@/lib/prisma";
import { isInvoicePaid, lightningConfigured } from "@/lib/lightning";
import { recordDeposit } from "@/lib/ledger";
import { payParticipant } from "@/lib/escrow-payout";
import { RESOLVE_WINDOW_MS } from "@/lib/escrow-config";
import {
  emitDepositReceived,
  emitBetFunded,
  emitBetExpired,
  emitBetRefunded,
} from "@/lib/webhooks";

/**
 * Marca un depósito como pagado y registra el asiento en el ledger.
 * Idempotente vía idempotencyKey en el ledger. Asume que el invoice ya se
 * verificó como pagado.
 */
async function settleDeposit(
  betId: string,
  stakeMsat: bigint,
  p: { id: string; userId: string; npub: string; depositPaymentHash: string },
  now: Date,
): Promise<void> {
  await prisma.betParticipant.update({
    where: { id: p.id },
    data: { depositStatus: "paid", paidAt: now },
  });
  await recordDeposit({
    betId,
    userId: p.userId,
    amountMsat: stakeMsat,
    idempotencyKey: `deposit:${betId}:${p.userId}`,
    paymentHash: p.depositPaymentHash,
  });
  await emitDepositReceived(betId, p.npub);
}

/**
 * Si la apuesta tiene todos los depósitos pagos, la promueve a `ready`.
 * Claim optimista para evitar dobles transiciones. Devuelve true si promovió.
 */
async function promoteIfAllPaid(betId: string, now: Date): Promise<boolean> {
  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { participants: true },
  });
  if (!bet || bet.status !== "pending_deposits") return false;
  if (
    bet.participants.length === 0 ||
    !bet.participants.every((p) => p.depositStatus === "paid")
  ) {
    return false;
  }
  const claimed = await prisma.bet.updateMany({
    where: { id: betId, status: "pending_deposits" },
    data: {
      status: "ready",
      readyAt: now,
      resolveDeadline: new Date(now.getTime() + RESOLVE_WINDOW_MS),
    },
  });
  if (claimed.count === 1) {
    await emitBetFunded(betId);
    return true;
  }
  return false;
}

/**
 * Verificación on-demand del depósito de UN participante: consulta el invoice y,
 * si está pagado, lo settlea y promueve la apuesta. Lo llama el endpoint de
 * estado en cada poll del jugador para detectar el pago en segundos en vez de
 * esperar el tick de ~1 min. Devuelve true si recién marcó el depósito.
 */
export async function checkAndSettleDeposit(
  participantId: string,
): Promise<boolean> {
  if (!lightningConfigured()) return false;
  const p = await prisma.betParticipant.findUnique({
    where: { id: participantId },
    include: { bet: true },
  });
  if (
    !p ||
    p.bet.status !== "pending_deposits" ||
    p.depositStatus !== "pending" ||
    !p.depositPaymentHash ||
    p.depositPaymentHash.startsWith("dev-")
  ) {
    return false;
  }
  const paid = await isInvoicePaid(p.depositPaymentHash).catch(() => false);
  if (!paid) return false;

  const now = new Date();
  await settleDeposit(
    p.betId,
    p.bet.stakeMsat,
    { id: p.id, userId: p.userId, npub: p.npub, depositPaymentHash: p.depositPaymentHash },
    now,
  );
  await promoteIfAllPaid(p.betId, now);
  return true;
}

/**
 * Procesa el ciclo de vida de las apuestas (lo dispara QStash cada ~1 min).
 * Idempotente: usa claim optimista de estado + idempotencyKey en el ledger.
 */
export async function runTick(): Promise<{
  deposits: number;
  ready: number;
  refunded: number;
  forfeited: number;
}> {
  const now = new Date();
  let deposits = 0;
  let ready = 0;
  let refunded = 0;
  let forfeited = 0;

  // A) Detectar depósitos pagados (lookup_invoice) en apuestas pending_deposits.
  if (lightningConfigured()) {
    const pend = await prisma.bet.findMany({
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
            await settleDeposit(
              bet.id,
              bet.stakeMsat,
              { id: p.id, userId: p.userId, npub: p.npub, depositPaymentHash: p.depositPaymentHash },
              now,
            );
            deposits++;
          }
        }
      }
    }
  }

  // B) pending_deposits con todos pagos → ready (claim optimista).
  const maybeReady = await prisma.bet.findMany({
    where: { status: "pending_deposits" },
    select: { id: true },
  });
  for (const { id } of maybeReady) {
    if (await promoteIfAllPaid(id, now)) ready++;
  }

  // C) Timeout de depósito (10 min, incompleto) → reembolso a los que pagaron.
  const expiredDep = await prisma.bet.findMany({
    where: { status: "pending_deposits", depositDeadline: { lt: now } },
    include: { participants: true },
  });
  for (const bet of expiredDep) {
    const claimed = await prisma.bet.updateMany({
      where: { id: bet.id, status: "pending_deposits" },
      data: { status: "refunding" },
    });
    if (claimed.count !== 1) continue;
    for (const p of bet.participants.filter((x) => x.depositStatus === "paid")) {
      await payParticipant({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
      refunded++;
    }
    await prisma.bet.update({
      where: { id: bet.id },
      data: { status: "cancelled_incomplete" },
    });
    await emitBetExpired(bet.id);
    await emitBetRefunded(bet.id, "expired");
  }

  // D) Timeout de resolución (15 min sin resultado) → reembolso total.
  const expiredRes = await prisma.bet.findMany({
    where: { status: "ready", resolveDeadline: { lt: now } },
    include: { participants: true },
  });
  for (const bet of expiredRes) {
    const claimed = await prisma.bet.updateMany({
      where: { id: bet.id, status: "ready" },
      data: { status: "refunding" },
    });
    if (claimed.count !== 1) continue;
    for (const p of bet.participants) {
      await payParticipant({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
      refunded++;
    }
    await prisma.bet.update({
      where: { id: bet.id },
      data: { status: "refunded_timeout" },
    });
    await emitBetRefunded(bet.id, "resolve_timeout");
  }

  // E) Forfeit: retiros (QR) no reclamados pasada la ventana de 60 min.
  const expiredWithdraw = await prisma.betParticipant.findMany({
    where: { payoutStatus: "withdraw_pending", withdrawDeadline: { lt: now } },
  });
  for (const p of expiredWithdraw) {
    await prisma.betParticipant.update({
      where: { id: p.id },
      data: { payoutStatus: "forfeited" },
    });
    // El outflow comprometido no se concretó → marcar failed (los sats quedan en la casa).
    await prisma.ledgerEntry.updateMany({
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

  return { deposits, ready, refunded, forfeited };
}
