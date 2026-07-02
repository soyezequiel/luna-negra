import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getPlayerAuth } from "@/lib/escrow-auth";
import { recordDepositV2 } from "@/lib/ledger-v2";
import { promoteIfAllPaidV2 } from "@/lib/zap-bet";
import { emitDepositReceivedV2 } from "@/lib/webhooks";

// Solo dev: simula el depósito del jugador para ver el flujo v2 sin pagar
// Lightning. No publica recibo 9735 (es un pago simulado): solo asienta el
// depósito y, si están todos, promueve a ready.
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
  const bet = await prisma.zapBet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const part = bet.participants.find((p) => p.userId === auth.sub);
  if (!part) return NextResponse.json({ error: "No participás" }, { status: 403 });

  if (part.depositStatus !== "paid") {
    await prisma.zapBetParticipant.update({
      where: { id: part.id },
      data: { depositStatus: "paid", paidAt: new Date() },
    });
    await recordDepositV2({
      betId: bet.id,
      userId: auth.sub,
      amountMsat: bet.stakeMsat,
      idempotencyKey: `deposit:${bet.id}:${auth.sub}`,
      paymentHash: part.depositPaymentHash ?? `dev-${randomBytes(8).toString("hex")}`,
    });
    await emitDepositReceivedV2(bet.id, part.npub);
  }

  await promoteIfAllPaidV2(bet.id, new Date());
  return NextResponse.json({ ok: true });
}
