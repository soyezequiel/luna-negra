import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { msatToSats } from "@/lib/money";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const parts = await prisma.betParticipant.findMany({
    where: { userId: session.sub },
    include: { bet: { include: { game: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    bets: parts.map((p) => ({
      id: p.bet.id,
      gameId: p.bet.gameId,
      gameSlug: p.bet.game.slug,
      gameTitle: p.bet.game.title,
      status: p.bet.status,
      stakeSats: Number(msatToSats(p.bet.stakeMsat)),
      depositStatus: p.depositStatus,
      result: p.result,
      payoutStatus: p.payoutStatus,
      createdAt: p.bet.createdAt,
    })),
  });
}
