import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import {
  betDetailInclude,
  buildV1BetDetail,
  buildZapBetDetail,
} from "@/lib/bet-detail";

// Detalle COMPLETO de una apuesta para el panel admin: sirve v1 (escrow) y v2
// (zaps). El front pasa `?v=1|2` (lo sabe por la fila); si falta, probamos v2 y
// caemos a v1. El mapeo Prisma → estructura auditable (árbol de flujo, ledger,
// recibos 9734/9735) vive en @/lib/bet-detail, compartido con la vista pública.

// Re-export para consumidores que ya importaban los tipos desde esta route.
export type {
  AdminBetDetail,
  AdminBetParticipant,
  AdminBetLedgerRow,
} from "@/lib/bet-detail";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const { searchParams } = new URL(_req.url);
  const v = searchParams.get("v");

  // v2 (zaps) salvo que la fila diga v1 explícitamente.
  if (v !== "1") {
    const b = await prisma.zapBet.findUnique({
      where: { id },
      include: betDetailInclude,
    });
    if (b) {
      return NextResponse.json(buildZapBetDetail(b));
    }
    if (v === "2") {
      return NextResponse.json({ error: "Apuesta no encontrada" }, { status: 404 });
    }
  }

  // v1 (escrow): sin campos de zap.
  const b = await prisma.bet.findUnique({
    where: { id },
    include: betDetailInclude,
  });
  if (!b) {
    return NextResponse.json({ error: "Apuesta no encontrada" }, { status: 404 });
  }
  return NextResponse.json(buildV1BetDetail(b));
}
