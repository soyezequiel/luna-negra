import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import {
  buildUnsignedZapRequest,
  loadZapContext,
  ZAP_CONTEXT_MESSAGE,
  type ZapContextError,
} from "@/lib/zap";

// Límites de una propina/zap, en sats. El mínimo evita zaps de polvo; el máximo
// es un guard de cordura (una propina no es una compra).
const MIN_ZAP_SATS = 1;
const MAX_ZAP_SATS = 1_000_000;

const isContextError = (v: unknown): v is ZapContextError =>
  typeof v === "string";

/**
 * Paso 1 del zap (NIP-57): arma el zap request (kind 9734) SIN firmar para que
 * el cliente lo firme con su identidad Nostr (así "se sabe quién mandó"). Valida
 * el gating del juego (gratis + anuncio + wallet del dev con zaps) y el monto.
 * El invoice se pide en el paso 2 (zap/invoice) con el request ya firmado.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const rl = await checkRateLimit(
    `zap-prep:${clientIp(req)}:${session.sub}`,
    15,
    60_000,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const amountSats = Number(body?.amountSats);
  if (
    !Number.isInteger(amountSats) ||
    amountSats < MIN_ZAP_SATS ||
    amountSats > MAX_ZAP_SATS
  ) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }
  const comment =
    typeof body?.comment === "string" ? body.comment.slice(0, 280) : undefined;

  const ctx = await loadZapContext(id);
  if (isContextError(ctx)) {
    const status = ctx === "not_found" ? 404 : 409;
    return NextResponse.json(
      { error: ZAP_CONTEXT_MESSAGE[ctx] },
      { status },
    );
  }

  // El monto tiene que caer dentro de los límites del LNURL-pay del dev (msat).
  const amountMsat = amountSats * 1000;
  if (
    amountMsat < ctx.endpoint.minSendable ||
    amountMsat > ctx.endpoint.maxSendable
  ) {
    return NextResponse.json(
      { error: "El monto está fuera de lo que acepta el wallet del dev" },
      { status: 400 },
    );
  }

  const unsignedZapRequest = buildUnsignedZapRequest({
    amountSats,
    comment,
    recipientPubkey: ctx.recipientPubkey,
    eventId: ctx.eventId,
    lnurl: ctx.endpoint.lnurl,
  });

  return NextResponse.json({ unsignedZapRequest });
}
