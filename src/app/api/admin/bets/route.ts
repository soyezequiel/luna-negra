import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { msatToSats } from "@/lib/money";

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const bets = await prisma.bet.findMany({
    include: { game: true, participants: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    bets: bets.map((b) => ({
      id: b.id,
      gameTitle: b.game.title,
      status: b.status,
      stakeSats: Number(msatToSats(b.stakeMsat)),
      paid: b.participants.filter((p) => p.depositStatus === "paid").length,
      total: b.participants.length,
    })),
  });
}
