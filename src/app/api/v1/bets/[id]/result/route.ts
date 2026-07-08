import { verifyEvent, type Event } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { signResultEvent } from "@/lib/nostr-server";
import { ensureOracleKey, getOracleSecret } from "@/lib/oracle-keys";
import { verifyApiKey } from "@/lib/api-keys";
import { settleBetWithResult, type SettleResult } from "@/lib/escrow-settle";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { betsV1Gone } from "@/lib/bets-v1-gate";

const MAX_AGE = 1800; // 30 min

// Reportar el resultado de una apuesta. Dos caminos de autenticación:
//
//  1) API KEY (recomendado): `Authorization: Bearer ln_sk_…` + body `{ winners }`.
//     Luna Negra construye y FIRMA el evento de resultado con el oráculo
//     gestionado del proveedor — el game server no toca Nostr.
//
//  2) EVENTO FIRMADO (avanzado): body `{ event }` firmado por la clave del
//     oráculo del proveedor (la firma ES la prueba; se valida contra oraclePubkey).
//
// Ambos comparten el mismo núcleo de liquidación (settleBetWithResult).
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
  const gone = betsV1Gone();
  if (gone) return gone;
  const { id: betId } = await params;
  // Cualquier excepción inesperada (decrypt del oráculo, DB, firma…) se traduce a
  // un error con la forma estándar `{ error: { code, message } }`. Sin esto, Next
  // devuelve un 500 desnudo sin cuerpo y el cliente sólo ve "respondió 500." sin
  // pista de la causa ni código accionable.
  try {
    const body = await req.json().catch(() => ({}));

    // ── Camino 1: API key (Luna Negra firma con el oráculo gestionado) ──
    // Se elige si NO viene un evento firmado y hay un header Authorization.
    const hasEvent = body?.event && typeof body.event === "object";
    if (!hasEvent && req.headers.get("authorization")) {
      return await handleApiKey(req, betId, body);
    }

    // ── Camino 2: evento Nostr firmado por el proveedor ──
    return await handleSignedEvent(betId, body);
  } catch (err) {
    console.error(`[bet-result] error inesperado liquidando ${betId}:`, err);
    return apiError(
      "SETTLE_ERROR",
      err instanceof Error ? err.message : "Error inesperado al liquidar la apuesta",
      500,
    );
  }
}

// ───────────────────────────── API key ─────────────────────────────
async function handleApiKey(req: Request, betId: string, body: unknown) {
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError(
      "INVALID_API_KEY",
      "API key inválida (Authorization: Bearer ln_sk_…)",
      401,
    );
  }

  const rl = await checkRateLimit(`bet-result:${providerId}`, 30, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
  }

  // Validar winners: array de npubs (vacío = empate/anulación → reembolso).
  const winners = (body as { winners?: unknown })?.winners;
  if (!Array.isArray(winners) || winners.some((w) => typeof w !== "string")) {
    return apiError(
      "BAD_WINNERS",
      "winners debe ser un array de npubs (vacío = anular)",
      400,
    );
  }
  const winnerNpubs = winners as string[];

  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { provider: { include: { owner: true } }, participants: true },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);

  // Autorización: la API key debe pertenecer al proveedor dueño de la apuesta.
  if (bet.providerId !== providerId) {
    return apiError("FORBIDDEN", "La API key no es del proveedor de esta apuesta", 403);
  }

  // Oráculo BYO (keyless): Luna no custodia la clave y no puede firmar por el juego.
  if (bet.provider.oracleSelfSigned) {
    return apiError(
      "SELF_SIGNED_ORACLE",
      "Este proveedor firma sus propios resultados con su clave de oráculo; Luna no puede firmar por él",
      409,
    );
  }

  // Firmar con el oráculo gestionado del proveedor. `getOracleSecret` puede
  // LANZAR (no sólo devolver null) si `ORACLE_ENC_KEY` falta/cambió o el blob
  // cifrado no autentica (AES-GCM). Ese throw hay que atraparlo acá: si se escapa,
  // sale como 500 desnudo y el host ve "respondió 500." sin saber que el problema
  // es la clave maestra. Lo convertimos en un error claro y accionable.
  let sk: Uint8Array | null = null;
  try {
    sk = await getOracleSecret(providerId);
    if (!sk) {
      await ensureOracleKey(providerId);
      sk = await getOracleSecret(providerId);
    }
  } catch (err) {
    console.error(`[bet-result] no se pudo acceder a la clave de oráculo de ${providerId}:`, err);
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
  const resultEvent = signResultEvent(sk, betId, winnerNpubs);

  const result = await settleBetWithResult({ bet, winnerNpubs, resultEvent });
  return toResponse(result);
}

// ──────────────────────── Evento firmado (legacy) ───────────────────────
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

  // El evento firmado debe corresponder a la apuesta de la URL.
  const evBetId = ev.tags.find((t) => t[0] === "bet")?.[1];
  if (!evBetId) return apiError("MISSING_BET", "Falta el tag bet en el evento", 400);
  if (evBetId !== betId) {
    return apiError("BET_MISMATCH", "El evento firmado no corresponde a esta apuesta", 400);
  }

  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { provider: { include: { owner: true } }, participants: true },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);

  // El firmante debe ser el ORÁCULO del proveedor (no el dueño humano).
  if (!bet.provider.oraclePubkey || ev.pubkey !== bet.provider.oraclePubkey) {
    return apiError("WRONG_SIGNER", "El resultado no está firmado por el oráculo del proveedor", 403);
  }

  const winnerNpubs = ev.tags.filter((t) => t[0] === "winner").map((t) => t[1]);
  const result = await settleBetWithResult({ bet, winnerNpubs, resultEvent: ev });
  return toResponse(result);
}
