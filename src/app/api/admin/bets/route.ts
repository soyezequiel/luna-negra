import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { msatToSats } from "@/lib/money";

// Apuestas para el panel admin: v1 escrow + v2 zaps (conviven, ver memoria
// apuestas-v2-zaps), en una lista ordenada por fecha. Cada fila trae `version`
// (para routear cancelar a /api/escrow vs /api/v2) y `payouts`: a qué wallet
// llegó el premio/reembolso de cada participante cobrado.

type PayoutInfo = {
  npub: string;
  payoutSats: number;
  payoutStatus: string;
  payoutDestination: string | null;
  payoutKind: string | null;
};

export type AdminBetRow = {
  id: string;
  version: 1 | 2;
  gameTitle: string;
  status: string;
  stakeSats: number;
  paid: number;
  total: number;
  payouts: PayoutInfo[];
};

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const [v1, v2] = await Promise.all([
    prisma.bet.findMany({
      include: { game: true, participants: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.zapBet.findMany({
      include: { game: true, participants: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const withDate: (AdminBetRow & { createdAt: Date })[] = [
    ...v1.map((b) => ({
      id: b.id,
      version: 1 as const,
      gameTitle: b.game.title,
      status: b.status,
      stakeSats: Number(msatToSats(b.stakeMsat)),
      paid: b.participants.filter((p) => p.depositStatus === "paid").length,
      total: b.participants.length,
      createdAt: b.createdAt,
      payouts: b.participants
        .filter((p) => p.payoutMsat != null)
        .map((p) => ({
          npub: p.npub,
          payoutSats: Number(msatToSats(p.payoutMsat as bigint)),
          payoutStatus: p.payoutStatus,
          payoutDestination: p.payoutDestination,
          payoutKind: null,
        })),
    })),
    ...v2.map((b) => ({
      id: b.id,
      version: 2 as const,
      gameTitle: b.game.title,
      status: b.status,
      stakeSats: Number(msatToSats(b.stakeMsat)),
      paid: b.participants.filter((p) => p.depositStatus === "paid").length,
      total: b.participants.length,
      createdAt: b.createdAt,
      payouts: b.participants
        .filter((p) => p.payoutMsat != null)
        .map((p) => ({
          npub: p.npub,
          payoutSats: Number(msatToSats(p.payoutMsat as bigint)),
          payoutStatus: p.payoutStatus,
          payoutDestination: p.payoutDestination,
          payoutKind: p.payoutKind,
        })),
    })),
  ];

  const bets: AdminBetRow[] = withDate
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 50)
    .map(({ createdAt: _createdAt, ...rest }) => rest);

  return NextResponse.json({ bets });
}
