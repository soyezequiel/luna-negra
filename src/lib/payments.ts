import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { lightningConfigured, payToLightningAddress } from "@/lib/lightning";

/**
 * Reparte el % del proveedor (revenueShare) a su Lightning Address.
 * Idempotente: solo paga si la compra está pagada y el payout no se hizo.
 * Best-effort: si falla, deja el entitlement intacto y marca el payout como
 * "failed" para reintentar luego.
 */
export async function maybePayout(purchaseId: string): Promise<void> {
  const p = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { game: { include: { provider: true } } },
  });

  if (!p || p.status !== "paid" || p.amountSats <= 0) return;
  if (p.payoutStatus === "paid" || p.payoutStatus === "pending") return;

  const address = p.game.provider.lightningAddress;
  if (!address || !lightningConfigured()) {
    // Sin wallet o sin dirección: dejamos constancia, sin bloquear la compra.
    await prisma.purchase.update({
      where: { id: p.id },
      data: { payoutStatus: "skipped" },
    });
    return;
  }

  const share = Math.floor((p.amountSats * p.game.revenueShare) / 100);
  if (share <= 0) return;

  await prisma.purchase.update({
    where: { id: p.id },
    data: { payoutStatus: "pending" },
  });

  try {
    const preimage = await payToLightningAddress(
      address,
      share,
      `Luna Negra · ${p.game.title}`,
    );
    await prisma.purchase.update({
      where: { id: p.id },
      data: { payoutStatus: "paid", payoutHash: preimage },
    });
  } catch (err) {
    // El proveedor no cobró su parte: alertar (queda en "failed" para reintento).
    Sentry.captureException(err, {
      level: "error",
      tags: { flow: "payout", purchaseId: p.id },
      extra: { gameId: p.gameId, shareSats: share },
    });
    await prisma.purchase.update({
      where: { id: p.id },
      data: { payoutStatus: "failed" },
    });
  }
}
