import { createHmac, randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

// Webhooks salientes: notifican al proveedor (compra, apuesta, payout).
// Firmados con HMAC-SHA256 usando el secreto del proveedor. Entrega vía QStash
// (reintentos) si hay QSTASH_TOKEN; si no, fetch directo (dev). Best-effort.

export function generateWebhookSecret(): string {
  return "whsec_" + randomBytes(24).toString("base64url");
}

export function signWebhook(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

type WebhookType = "purchase.completed" | "payout.sent" | "bet.settled";

async function deliver(
  providerId: string,
  type: WebhookType,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { webhookUrl: true, webhookSecret: true },
    });
    if (!provider?.webhookUrl || !provider.webhookSecret) return;

    const payload = {
      id: randomUUID(),
      type,
      created: new Date().toISOString(),
      data,
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-LunaNegra-Event": type,
      "X-LunaNegra-Signature": signWebhook(body, provider.webhookSecret),
    };

    const token = process.env.QSTASH_TOKEN;
    if (token) {
      const { Client } = await import("@upstash/qstash");
      await new Client({ token }).publishJSON({
        url: provider.webhookUrl,
        body: payload,
        headers,
      });
    } else {
      // Sin QStash (dev): entrega directa best-effort.
      await fetch(provider.webhookUrl, { method: "POST", headers, body });
    }
  } catch {
    /* best-effort: un webhook fallido no rompe el flujo principal */
  }
}

export async function emitPurchaseCompleted(purchaseId: string): Promise<void> {
  const p = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { game: true, user: true },
  });
  if (!p) return;
  await deliver(p.game.providerId, "purchase.completed", {
    purchaseId: p.id,
    gameId: p.gameId,
    slug: p.game.slug,
    npub: p.user.npub,
    amountSats: p.amountSats,
    paidAt: p.paidAt,
  });
}

export async function emitPayoutSent(purchaseId: string): Promise<void> {
  const p = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { game: true },
  });
  if (!p || p.payoutStatus !== "paid") return;
  const shareSats = Math.floor((p.amountSats * p.game.revenueShare) / 100);
  await deliver(p.game.providerId, "payout.sent", {
    purchaseId: p.id,
    gameId: p.gameId,
    shareSats,
    payoutHash: p.payoutHash,
  });
}

export async function emitBetSettled(betId: string): Promise<void> {
  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { participants: true },
  });
  if (!bet) return;
  const winners = bet.participants
    .filter((p) => p.result === "won" || p.result === "tie")
    .map((p) => p.npub);
  await deliver(bet.providerId, "bet.settled", {
    betId: bet.id,
    gameId: bet.gameId,
    winners,
  });
}
