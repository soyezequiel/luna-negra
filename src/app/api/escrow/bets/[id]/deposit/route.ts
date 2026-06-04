import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getPlayerAuth } from "@/lib/escrow-auth";
import { createInvoice, lightningConfigured } from "@/lib/lightning";
import { msatToSats } from "@/lib/money";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getPlayerAuth(req);
  if (!auth) return fail("UNAUTHENTICATED", "No autenticado", 401);
  const rl = await checkRateLimit(`bet-deposit:${clientIp(req)}:${auth.sub}`, 30, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos", code: "RATE_LIMITED" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { id } = await params;
  const bet = await prisma.bet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return fail("BET_NOT_FOUND", "Apuesta no encontrada", 404);

  const part = bet.participants.find((p) => p.userId === auth.sub);
  if (!part) return fail("NOT_PARTICIPANT", "No sos participante de esta apuesta", 403);

  const closed =
    bet.status !== "pending_deposits" ||
    (bet.depositDeadline != null && bet.depositDeadline < new Date());
  if (closed) return fail("DEPOSIT_CLOSED", "El depósito está cerrado", 410);

  if (part.depositStatus === "paid") {
    return fail("ALREADY_PAID", "Ya depositaste", 409);
  }

  // Idempotente: reusar el invoice ya generado.
  if (part.depositInvoice && part.depositPaymentHash) {
    return NextResponse.json({
      invoice: part.depositInvoice,
      paymentHash: part.depositPaymentHash,
      devMode: !lightningConfigured(),
    });
  }

  const sats = Number(msatToSats(bet.stakeMsat));
  const devMode = !lightningConfigured();
  const inv = devMode
    ? {
        invoice: `lnbc-dev-${randomBytes(12).toString("hex")}`,
        paymentHash: `dev-${randomBytes(16).toString("hex")}`,
      }
    : await createInvoice(sats, `Luna Negra · apuesta ${bet.id}`);

  await prisma.betParticipant.update({
    where: { id: part.id },
    data: { depositInvoice: inv.invoice, depositPaymentHash: inv.paymentHash },
  });

  return NextResponse.json({
    invoice: inv.invoice,
    paymentHash: inv.paymentHash,
    devMode,
  });
}
