import { NextResponse } from "next/server";
import { nip57 } from "nostr-tools";
import { getSession } from "@/lib/auth";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
import {
  fetchZapInvoice,
  loadZapContext,
  ZAP_CONTEXT_MESSAGE,
  type ZapContextError,
} from "@/lib/zap";

const MIN_ZAP_SATS = 1;
const MAX_ZAP_SATS = 1_000_000;

const isContextError = (v: unknown): v is ZapContextError =>
  typeof v === "string";

type SignedEvent = {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  id: string;
  sig: string;
};

function tagValue(ev: SignedEvent, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}

/**
 * Paso 2 del zap (NIP-57): recibe el zap request (9734) ya firmado por el
 * usuario, lo valida CONTRA el contexto re-resuelto del juego (anti-tampering:
 * `p`/`e`/`amount`/`lnurl` deben coincidir con lo que pusimos en el paso 1) y le
 * pide el invoice al wallet del dev. El recibo (9735) lo emite ese wallet; el
 * top sale de ahí (zap-sync.ts), no de este endpoint.
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
    `zap-inv:${clientIp(req)}:${session.sub}`,
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
  const signed = body?.signedZapRequest as SignedEvent | undefined;
  if (!signed || typeof signed !== "object") {
    return NextResponse.json(
      { error: "Falta el zap request firmado" },
      { status: 400 },
    );
  }

  // Firma + estructura del 9734 (NIP-57). Cubre validateEvent + verifyEvent.
  const invalid = nip57.validateZapRequest(JSON.stringify(signed));
  if (invalid || signed.kind !== 9734) {
    return NextResponse.json(
      { error: "Zap request inválido" },
      { status: 400 },
    );
  }
  // El que firma el zap es el que está logueado (así "se sabe quién mandó").
  if (signed.pubkey !== session.pubkey) {
    return NextResponse.json(
      { error: "El zap request no está firmado por tu sesión" },
      { status: 403 },
    );
  }

  const ctx = await loadZapContext(id);
  if (isContextError(ctx)) {
    const status = ctx === "not_found" ? 404 : 409;
    return NextResponse.json({ error: ZAP_CONTEXT_MESSAGE[ctx] }, { status });
  }

  // Anti-tampering: lo firmado tiene que coincidir con lo que armamos.
  const amountMsat = Number(tagValue(signed, "amount"));
  const amountSats = amountMsat / 1000;
  const ok =
    Number.isInteger(amountMsat) &&
    Number.isInteger(amountSats) &&
    amountSats >= MIN_ZAP_SATS &&
    amountSats <= MAX_ZAP_SATS &&
    amountMsat >= ctx.endpoint.minSendable &&
    amountMsat <= ctx.endpoint.maxSendable &&
    tagValue(signed, "p") === ctx.recipientPubkey &&
    tagValue(signed, "e") === ctx.eventId &&
    tagValue(signed, "lnurl") === ctx.endpoint.lnurl;
  if (!ok) {
    return NextResponse.json(
      { error: "El zap request no coincide con el juego" },
      { status: 400 },
    );
  }

  try {
    const invoice = await fetchZapInvoice({
      callback: ctx.endpoint.callback,
      amountMsat,
      signedZapRequest: JSON.stringify(signed),
      lnurl: ctx.endpoint.lnurl,
    });
    return NextResponse.json({ invoice, amountSats });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "No se pudo generar el invoice del zap",
      },
      { status: 502 },
    );
  }
}
