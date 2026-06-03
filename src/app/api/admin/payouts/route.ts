import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";

// Payouts pendientes de resolver (no pagados) — para reintentar desde /admin.
export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const rows = await prisma.purchase.findMany({
    where: {
      status: "paid",
      amountSats: { gt: 0 },
      payoutStatus: { in: ["failed", "skipped", "pending"] },
    },
    include: { game: { include: { provider: true } } },
    orderBy: { paidAt: "desc" },
  });
  return NextResponse.json({
    payouts: rows.map((p) => ({
      id: p.id,
      gameTitle: p.game.title,
      providerName: p.game.provider.name,
      lightningAddress: p.game.provider.lightningAddress,
      share: Math.floor((p.amountSats * p.game.revenueShare) / 100),
      payoutStatus: p.payoutStatus,
    })),
  });
}
