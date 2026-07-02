import { verifyEvent, type Event } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { signResultEventV2 } from "@/lib/nostr-server";
import { ensureOracleKey, getOracleSecret } from "@/lib/oracle-keys";
import { verifyApiKey } from "@/lib/api-keys";
import { settleZapBetWithResult, type SettleResult } from "@/lib/escrow-v2-settle";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";

const MAX_AGE = 1800; // 30 min

// Reportar el resultado de una apuesta v2. Mismos dos caminos que v1: API key
// (Luna Negra firma con el oráculo gestionado) o evento firmado por el oráculo
// del proveedor. Comparten el núcleo settleZapBetWithResult (pagos por zap).
export function OPTIONS() {
  return corsPreflight();
}

function toResponse(r: SettleResult) {
  if (r.ok) {
    return apiOk({
      ok: true,
      ...(r.voided ? { voided: true } : {}),
      ...(r.alreadyResolved ? { alreadyResolved: true } : {}),
      ...(r.finalStatus ? { status: r.finalStatus } : {}),
    });
  }
  return apiError(r.code, r.message, r.status);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!BETS_V2_ENABLED) {
    return apiError("BETS_V2_DISABLED", "Las apuestas v2 están desactivadas", 503);
  }
  const { id: betId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const hasEvent = body?.event && typeof body.event === "object";
    if (!hasEvent && req.headers.get("authorization")) {
      return await handleApiKey(req, betId, body);
    }
    return await handleSignedEvent(betId, body);
  } catch (err) {
    console.error(`[bet-v2-result] error inesperado liquidando ${betId}:`, err);
    return apiError(
      "SETTLE_ERROR",
      err instanceof Error ? err.message : "Error inesperado al liquidar la apuesta",
      500,
    );
  }
}

async function handleApiKey(req: Request, betId: string, body: unknown) {
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);
  }

  const rl = await checkRateLimit(`bet-v2-result:${providerId}`, 30, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
  }

  const winners = (body as { winners?: unknown })?.winners;
  if (!Array.isArray(winners) || winners.some((w) => typeof w !== "string")) {
    return apiError("BAD_WINNERS", "winners debe ser un array de npubs (vacío = anular)", 400);
  }
  const winnerNpubs = winners as string[];

  const bet = await prisma.zapBet.findUnique({
    where: { id: betId },
    include: { provider: { include: { owner: true } }, participants: true },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);
  if (bet.providerId !== providerId) {
    return apiError("FORBIDDEN", "La API key no es del proveedor de esta apuesta", 403);
  }

  let sk: Uint8Array | null = null;
  try {
    sk = await getOracleSecret(providerId);
    if (!sk) {
      await ensureOracleKey(providerId);
      sk = await getOracleSecret(providerId);
    }
  } catch (err) {
    console.error(`[bet-v2-result] no se pudo acceder a la clave de oráculo de ${providerId}:`, err);
    return apiError(
      "ORACLE_KEY_ERROR",
      "No se pudo acceder a la clave de oráculo del proveedor (revisá ORACLE_ENC_KEY en el servidor)",
      500,
    );
  }
  if (!sk) {
    return apiError(
      "ORACLE_NOT_PROVISIONED",
      "El proveedor no tiene clave de oráculo gestionada; contactá soporte para provisionarla",
      409,
    );
  }
  const resultEvent = signResultEventV2(sk, betId, winnerNpubs, bet.anchorEventId);

  const result = await settleZapBetWithResult({ bet, winnerNpubs, resultEvent });
  return toResponse(result);
}

async function handleSignedEvent(betId: string, body: unknown) {
  const ev = (body as { event?: Event })?.event;
  if (!ev || typeof ev !== "object" || !Array.isArray(ev.tags)) {
    return apiError("BAD_EVENT", "Evento inválido", 400);
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - (ev.created_at ?? 0)) > MAX_AGE) {
    return apiError("STALE", "Evento expirado", 400);
  }
  if (!verifyEvent(ev)) return apiError("BAD_SIGNATURE", "Firma inválida", 401);

  const evBetId = ev.tags.find((t) => t[0] === "bet")?.[1];
  if (!evBetId) return apiError("MISSING_BET", "Falta el tag bet en el evento", 400);
  if (evBetId !== betId) {
    return apiError("BET_MISMATCH", "El evento firmado no corresponde a esta apuesta", 400);
  }

  const bet = await prisma.zapBet.findUnique({
    where: { id: betId },
    include: { provider: { include: { owner: true } }, participants: true },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);

  if (!bet.provider.oraclePubkey || ev.pubkey !== bet.provider.oraclePubkey) {
    return apiError("WRONG_SIGNER", "El resultado no está firmado por el oráculo del proveedor", 403);
  }

  const winnerNpubs = ev.tags.filter((t) => t[0] === "winner").map((t) => t[1]);
  const result = await settleZapBetWithResult({ bet, winnerNpubs, resultEvent: ev });
  return toResponse(result);
}
