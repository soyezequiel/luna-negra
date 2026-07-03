import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import { validateDepositZapRequest, ensureDepositInvoiceV2 } from "@/lib/zap-bet";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";
import { siteUrl } from "@/lib/site-url";
import { notifyOperationalError } from "@/lib/discord";

// Paso 2 del depósito por zap (v2): recibe el 9734 firmado, lo valida contra el
// contrato (anti-tampering) y emite el invoice con el NWC de la tienda. El recibo
// 9735 lo publica la propia tienda cuando detecta el pago (settleDepositV2).

type SignedZapRequest = {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  id: string;
  sig: string;
};

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
  const rl = await checkRateLimit(`v2-dep-inv:${clientIp(req)}:${session.sub}`, 15, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const signed = body?.signedZapRequest as SignedZapRequest | undefined;
  if (!signed || typeof signed !== "object") {
    return NextResponse.json({ error: "Falta el zap request firmado" }, { status: 400 });
  }
  if (signed.pubkey !== session.pubkey) {
    return NextResponse.json(
      { error: "El zap request no está firmado por tu sesión" },
      { status: 403 },
    );
  }

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

  const check = validateDepositZapRequest(bet, part, signed, siteUrl(req));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const inv = await ensureDepositInvoiceV2(bet, part, signed);
    return NextResponse.json({ invoice: inv.invoice, paymentHash: inv.paymentHash });
  } catch (e) {
    await notifyOperationalError({
      source: "api-v2-deposit-invoice",
      error: e,
      fingerprint: `api-v2-deposit-invoice:${part.id}`,
      context: { betId: bet.id, participantId: part.id },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo generar el invoice" },
      { status: 502 },
    );
  }
}
