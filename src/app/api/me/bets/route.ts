import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { msatToSats } from "@/lib/money";

// Apuestas del jugador unificadas (v1 escrow + v2 zaps) para el perfil. v1 y v2
// conviven (ver memoria apuestas-v2-zaps); el perfil las mezcla ordenadas por
// fecha. Cada fila trae `version` (1|2) para linkear al detalle correcto
// (/bets vs /apuestas) y el destino del premio (payoutDestination/payoutKind),
// que responde "a qué wallet llegó la plata". Endpoint aparte de
// /api/escrow/bets/mine (v1-only) para no romper /bets ni game-bets.

export type MyBetRow = {
  id: string;
  version: 1 | 2;
  gameSlug: string;
  gameTitle: string;
  status: string;
  stakeSats: number;
  depositStatus: string;
  result: string;
  payoutStatus: string;
  payoutSats: number | null;
  /** Lightning Address / lud16 al que se movió el premio (null = sin destino). */
  payoutDestination: string | null;
  /** Cómo salió la plata: zap | lnurl | withdraw (v1 no distingue → null). */
  payoutKind: string | null;
  createdAt: string;
};

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const [v1, v2] = await Promise.all([
    prisma.betParticipant.findMany({
      where: { userId: session.sub },
      include: { bet: { include: { game: { select: { slug: true, title: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.zapBetParticipant.findMany({
      where: { userId: session.sub },
      include: { bet: { include: { game: { select: { slug: true, title: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const rows: MyBetRow[] = [
    ...v1.map(
      (p): MyBetRow => ({
        id: p.bet.id,
        version: 1,
        gameSlug: p.bet.game.slug,
        gameTitle: p.bet.game.title,
        status: p.bet.status,
        stakeSats: Number(msatToSats(p.bet.stakeMsat)),
        depositStatus: p.depositStatus,
        result: p.result,
        payoutStatus: p.payoutStatus,
        payoutSats: p.payoutMsat != null ? Number(msatToSats(p.payoutMsat)) : null,
        payoutDestination: p.payoutDestination,
        payoutKind: null,
        createdAt: p.bet.createdAt.toISOString(),
      }),
    ),
    ...v2.map(
      (p): MyBetRow => ({
        id: p.bet.id,
        version: 2,
        gameSlug: p.bet.game.slug,
        gameTitle: p.bet.game.title,
        status: p.bet.status,
        stakeSats: Number(msatToSats(p.bet.stakeMsat)),
        depositStatus: p.depositStatus,
        result: p.result,
        payoutStatus: p.payoutStatus,
        payoutSats: p.payoutMsat != null ? Number(msatToSats(p.payoutMsat)) : null,
        payoutDestination: p.payoutDestination,
        payoutKind: p.payoutKind,
        createdAt: p.bet.createdAt.toISOString(),
      }),
    ),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);

  return NextResponse.json({ bets: rows });
}
