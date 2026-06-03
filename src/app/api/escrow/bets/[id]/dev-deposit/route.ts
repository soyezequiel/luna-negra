import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getPlayerAuth } from "@/lib/escrow-auth";
import { recordDeposit } from "@/lib/ledger";
import { RESOLVE_WINDOW_MS } from "@/lib/escrow-config";

// Solo dev: simula el depósito del jugador para ver el flujo sin pagar Lightning.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "No disponible" }, { status: 403 });
  }
  const auth = await getPlayerAuth(req);
  if (!auth) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const bet = await prisma.bet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const part = bet.participants.find((p) => p.userId === auth.sub);
  if (!part) return NextResponse.json({ error: "No participás" }, { status: 403 });

  if (part.depositStatus !== "paid") {
    await prisma.betParticipant.update({
      where: { id: part.id },
      data: { depositStatus: "paid", paidAt: new Date() },
    });
    await recordDeposit({
      betId: bet.id,
      userId: auth.sub,
      amountMsat: bet.stakeMsat,
      idempotencyKey: `deposit:${bet.id}:${auth.sub}`,
      paymentHash: part.depositPaymentHash ?? `dev-${randomBytes(8).toString("hex")}`,
    });
  }

  // Si depositaron todos → ready
  const fresh = await prisma.betParticipant.findMany({ where: { betId: bet.id } });
  if (fresh.every((p) => p.depositStatus === "paid") && bet.status === "pending_deposits") {
    await prisma.bet.update({
      where: { id: bet.id },
      data: {
        status: "ready",
        readyAt: new Date(),
        resolveDeadline: new Date(Date.now() + RESOLVE_WINDOW_MS),
      },
    });
  }
  return NextResponse.json({ ok: true });
}
