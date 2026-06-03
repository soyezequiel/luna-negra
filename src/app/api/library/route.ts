import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const purchases = await prisma.purchase.findMany({
    where: { userId: session.sub, status: "paid" },
    include: { game: true },
    orderBy: { paidAt: "desc" },
  });

  return NextResponse.json({
    games: purchases.map((p) => ({
      id: p.game.id,
      slug: p.game.slug,
      title: p.game.title,
      coverUrl: p.game.coverUrl,
      gameUrl: p.game.gameUrl,
    })),
  });
}
