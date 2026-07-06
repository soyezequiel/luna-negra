import { verifyApiKeyFull } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { getStorePubkey } from "@/lib/nostr-server";
import { ensureOracleKey } from "@/lib/oracle-keys";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { BET_MIN_SATS, BET_MAX_SATS, BETS_V2_ENABLED } from "@/lib/escrow-v2-config";
import {
  NGP_BETS_ENABLED,
  NGP_BET_CONTRACT_KIND,
  NGP_BET_TAG,
} from "@/lib/ngp-bet-state";

// Config que un juego necesita para armar un contrato NGP kind:1339 (§2): la
// pubkey de la tienda (escrow), la pubkey del oráculo del proveedor, la
// coordenada del juego y los límites de stake publicados. Reemplaza el "leé la
// doc de la API": el juego lo consulta con su API key y arma el contrato sin
// hardcodear nada. Ver docs/nostr-games-protocol-apuestas.md.
export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  if (!BETS_V2_ENABLED || !NGP_BETS_ENABLED) {
    return apiError("NGP_DISABLED", "Las apuestas NGP están desactivadas", 503);
  }
  const identity = await verifyApiKeyFull(req);
  if (!identity) {
    return apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);
  }
  const { providerId, gameId: keyGameId } = identity;

  const gameId = new URL(req.url).searchParams.get("gameId")?.trim() || keyGameId || "";
  if (!gameId) return apiError("MISSING_GAME", "Falta gameId", 400);

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { providerId: true, nostrCoord: true, status: true },
  });
  if (!game) return apiError("GAME_NOT_FOUND", "Juego no encontrado", 404);
  if (game.providerId !== providerId) {
    return apiError("NOT_GAME_OWNER", "El juego no es de tu proveedor", 403);
  }
  if (game.status !== "published" || !game.nostrCoord) {
    return apiError("GAME_NOT_PUBLISHED", "El juego no está publicado en Nostr (sin coordenada)", 409);
  }

  const storePubkey = getStorePubkey();
  if (!storePubkey) {
    return apiError("STORE_NOT_CONFIGURED", "La tienda no tiene identidad Nostr configurada", 503);
  }

  let oraclePubkey: string;
  try {
    oraclePubkey = await ensureOracleKey(providerId);
  } catch {
    return apiError(
      "ORACLE_NOT_PROVISIONED",
      "No se pudo provisionar la clave de oráculo del proveedor (revisá ORACLE_ENC_KEY)",
      500,
    );
  }

  return apiOk({
    storePubkey,
    oraclePubkey,
    gameCoord: game.nostrCoord,
    minStakeSats: BET_MIN_SATS,
    maxStakeSats: BET_MAX_SATS,
    contractKind: NGP_BET_CONTRACT_KIND,
    tag: NGP_BET_TAG,
  });
}
