import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { betsV1Gone } from "@/lib/bets-v1-gate";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { payParticipant } from "@/lib/escrow-payout";

// Cancelación admin de una apuesta INCOMPLETA (pending_deposits) → reembolso.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gone = betsV1Gone();
  if (gone) return gone;
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const bet = await prisma.bet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (bet.status !== "pending_deposits") {
    return NextResponse.json(
      { error: "Solo se pueden cancelar apuestas incompletas" },
      { status: 400 },
    );
  }

  const claimed = await prisma.bet.updateMany({
    where: { id, status: "pending_deposits" },
    data: { status: "refunding" },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "Estado cambiado" }, { status: 409 });
  }

  for (const p of bet.participants.filter((x) => x.depositStatus === "paid")) {
    await payParticipant({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
  }
  await prisma.bet.update({ where: { id }, data: { status: "cancelled_admin" } });
  return NextResponse.json({ ok: true });
}
