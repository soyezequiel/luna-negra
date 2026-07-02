import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { checkAndSettleDepositV2 } from "@/lib/zap-bet";
import { publicBetStatus } from "@/lib/escrow-math";

// Estado del depósito del PROPIO usuario (sesión), para que la tarjeta de depósito
// poll-ee tras pagar. Dispara la detección on-demand (checkAndSettleDepositV2) para
// reflejar el pago en segundos. No expone datos de otros participantes.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const bet = await prisma.zapBet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return NextResponse.json({ error: "Apuesta no encontrada" }, { status: 404 });

  const part = bet.participants.find((p) => p.pubkey === session.pubkey);
  if (!part) return NextResponse.json({ error: "No sos participante" }, { status: 403 });

  // Detección on-demand del propio depósito (settlea + publica el 9735 si pagó).
  if (bet.status === "pending_deposits" && part.depositStatus === "pending") {
    await checkAndSettleDepositV2(part.id).catch(() => false);
  }

  const fresh = await prisma.zapBetParticipant.findUnique({ where: { id: part.id } });
  const freshBet = await prisma.zapBet.findUnique({
    where: { id },
    select: { status: true },
  });

  return NextResponse.json(
    {
      participantId: part.id,
      depositStatus: fresh?.depositStatus ?? part.depositStatus,
      depositReceiptId: fresh?.depositReceiptId ?? null,
      payoutStatus: fresh?.payoutStatus ?? part.payoutStatus,
      betStatus: publicBetStatus(freshBet?.status ?? bet.status),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
