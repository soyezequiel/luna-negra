import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  if (!provider) return NextResponse.json({ sales: [] });

  const sales = await prisma.purchase.findMany({
    where: { status: "paid", game: { providerId: provider.id } },
    include: { game: true },
    orderBy: { paidAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    sales: sales.map((s) => ({
      id: s.id,
      gameTitle: s.game.title,
      share: Math.floor((s.amountSats * s.game.revenueShare) / 100),
      payoutStatus: s.payoutStatus,
    })),
  });
}
