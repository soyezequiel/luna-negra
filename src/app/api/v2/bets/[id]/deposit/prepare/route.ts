import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { buildDepositZapRequest } from "@/lib/zap-bet";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";
import { siteUrl } from "@/lib/site-url";

// Paso 1 del depósito por zap (v2): arma el zap request (9734) SIN firmar para que
// el apostador lo firme con su identidad. Requiere sesión y que el que pide sea el
// participante que va a depositar (así el 9735 identifica quién puso la plata).

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!BETS_V2_ENABLED) {
    return NextResponse.json({ error: "Apuestas v2 desactivadas" }, { status: 503 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const rl = await checkRateLimit(`v2-dep-prep:${clientIp(req)}:${session.sub}`, 15, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { id } = await params;
  const bet = await prisma.zapBet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return NextResponse.json({ error: "Apuesta no encontrada" }, { status: 404 });

  const part = bet.participants.find((p) => p.pubkey === session.pubkey);
  if (!part) {
    return NextResponse.json({ error: "No sos participante de esta apuesta" }, { status: 403 });
  }
  const open =
    bet.status === "pending_deposits" &&
    (bet.depositDeadline == null || bet.depositDeadline > new Date());
  if (!open) return NextResponse.json({ error: "El depósito está cerrado" }, { status: 409 });
  if (part.depositStatus === "paid") {
    return NextResponse.json({ error: "Ya depositaste" }, { status: 409 });
  }

  try {
    const unsignedZapRequest = buildDepositZapRequest(bet, part, siteUrl(req));
    return NextResponse.json({ participantId: part.id, unsignedZapRequest });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo preparar el depósito" },
      { status: 503 },
    );
  }
}
