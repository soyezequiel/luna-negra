import { NextResponse } from "next/server";
import { after } from "next/server";
import { verifyApiKeyFull } from "@/lib/api-keys";
import { materializeNgpBet } from "@/lib/ngp-bet-ingest";
import { buildBetCreateBody } from "@/lib/escrow-v2-serialize";
import { trackIntegration } from "@/lib/integration-telemetry";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiError, corsPreflight, CORS } from "@/lib/api";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";
import { NGP_BETS_ENABLED } from "@/lib/ngp-bet-state";
import { notifyOperationalError } from "@/lib/discord";

// Materialización EAGER de un contrato NGP kind:1339 (§2, Fase 2). El juego
// publicó el contrato firmado (por él o por el retador) y acá pide crear la
// apuesta v2 correspondiente, autenticándose con su API key. Reusa el mismo
// núcleo que el camino LNURL (`materializeNgpBet`) pero autoriza por dueño del
// juego en vez de por firmante del depósito, y devuelve el MISMO shape que
// `POST /api/v2/bets`, así el juego reusa todo su flujo (depósito, resultado).
//
// A diferencia de `POST /api/v2/bets`, el ancla NO la firma Luna: es el id del
// 1339, firmado fuera de Luna → el contrato es verificable y portable.
export function OPTIONS() {
  return corsPreflight();
}

// Mapea el código de error de la ingesta a un status HTTP.
function statusForNgp(code: string): number {
  switch (code) {
    case "CONTRACT_NOT_FOUND":
    case "GAME_NOT_FOUND":
      return 404;
    case "NOT_GAME_OWNER":
      return 403;
    case "NGP_DISABLED":
    case "STORE_NOT_CONFIGURED":
    case "ORACLE_NOT_PROVISIONED":
      return 503;
    default:
      return 400; // BAD_SIGNATURE, WRONG_ESCROW, STAKE_OUT_OF_RANGE, CONTRACT_EXPIRED, etc.
  }
}

export async function POST(req: Request) {
  if (!BETS_V2_ENABLED || !NGP_BETS_ENABLED) {
    return apiError("NGP_DISABLED", "Las apuestas NGP están desactivadas", 503);
  }
  const identity = await verifyApiKeyFull(req);
  if (!identity) {
    return apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);
  }
  const { providerId } = identity;

  const rl = await checkRateLimit(`ngp-from-contract:${providerId}`, 20, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
  }

  const body = (await req.json().catch(() => ({}))) as { contractEventId?: unknown };
  const contractEventId =
    typeof body.contractEventId === "string" ? body.contractEventId.trim() : "";
  if (!/^[a-f0-9]{64}$/.test(contractEventId)) {
    return apiError("BAD_CONTRACT_ID", "contractEventId debe ser el id hex del evento 1339", 400);
  }

  const res = await materializeNgpBet(contractEventId, { expectedProviderId: providerId }).catch(
    async (error) => {
      await notifyOperationalError({
        source: "api-v2-from-contract",
        error,
        fingerprint: `api-v2-from-contract:${providerId}:${contractEventId}`,
        context: { providerId, contractEventId },
      });
      return { ok: false as const, code: "INGEST_ERROR", error: "No se pudo materializar el contrato" };
    },
  );
  if (!res.ok) {
    const status = res.code === "INGEST_ERROR" ? 500 : statusForNgp(res.code);
    return apiError(res.code, res.error, status);
  }

  const bodyOut = await buildBetCreateBody(res.betId);
  if (!bodyOut) {
    return apiError("BET_NOT_FOUND", "La apuesta se materializó pero no se pudo leer", 500);
  }

  after(() => trackIntegration("bets", { providerId, gameId: res.gameId }));
  return NextResponse.json(bodyOut, { status: 201, headers: CORS });
}
