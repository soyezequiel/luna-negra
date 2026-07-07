import { providerIdFromRequest } from "@/lib/provider-auth";
import { prisma } from "@/lib/prisma";
import { siteUrl } from "@/lib/site-url";
import { issueNgeCredential, getNgeCredential } from "@/lib/nge-credential";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";
import { NGP_BETS_ENABLED } from "@/lib/ngp-bet-state";

// Emisor de la credencial NGE (la "NWC del escrow"). El dueño del juego (sesión del
// panel o API key del proveedor) pide su credencial; Luna genera/reusa el par de
// servicio, publica el bind event y devuelve la URI nostr+nge:// para pegar en
// NGE_CONNECTION. Ver src/lib/nge-credential.ts y docs/nge/.

export function OPTIONS() {
  return corsPreflight();
}

function statusFor(code: string): number {
  switch (code) {
    case "GAME_NOT_FOUND":
      return 404;
    case "NOT_GAME_OWNER":
      return 403;
    case "GAME_NOT_PUBLISHED":
      return 409;
    case "STORE_NOT_CONFIGURED":
      return 503;
    default:
      return 400;
  }
}

/** Resuelve el gameId pedido y verifica que sea del proveedor autenticado. */
async function authorizeGame(
  req: Request,
  gameId: string,
): Promise<{ ok: true; gameId: string } | { ok: false; code: string; message: string; status: number }> {
  const providerId = await providerIdFromRequest(req);
  if (!providerId) {
    return { ok: false, code: "UNAUTHORIZED", message: "No autenticado como proveedor", status: 401 };
  }
  if (!gameId) return { ok: false, code: "MISSING_GAME", message: "Falta gameId", status: 400 };
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { providerId: true } });
  if (!game) return { ok: false, code: "GAME_NOT_FOUND", message: "Juego no encontrado", status: 404 };
  if (game.providerId !== providerId) {
    return { ok: false, code: "NOT_GAME_OWNER", message: "El juego no es de tu proveedor", status: 403 };
  }
  return { ok: true, gameId };
}

export async function POST(req: Request) {
  if (!BETS_V2_ENABLED || !NGP_BETS_ENABLED) {
    return apiError("NGP_DISABLED", "Las apuestas NGP están desactivadas", 503);
  }
  const body = (await req.json().catch(() => ({}))) as { gameId?: unknown; rotate?: unknown };
  const gameId = typeof body.gameId === "string" ? body.gameId.trim() : "";
  const rotate = body.rotate === true;

  const auth = await authorizeGame(req, gameId);
  if (!auth.ok) return apiError(auth.code, auth.message, auth.status);

  const res = await issueNgeCredential({ gameId: auth.gameId, baseUrl: siteUrl(req), rotate });
  if (!res.ok) return apiError(res.code, res.message, statusFor(res.code));

  return apiOk({
    uri: res.uri,
    escrowPubkey: res.escrowPubkey,
    servicePubkey: res.servicePubkey,
    gameCoord: res.gameCoord,
    relays: res.relays,
    rotated: res.rotated,
    bindPublished: res.bindPublished,
    envVar: "NGE_CONNECTION",
  });
}

export async function GET(req: Request) {
  if (!BETS_V2_ENABLED || !NGP_BETS_ENABLED) {
    return apiError("NGP_DISABLED", "Las apuestas NGP están desactivadas", 503);
  }
  const gameId = new URL(req.url).searchParams.get("gameId")?.trim() || "";
  const auth = await authorizeGame(req, gameId);
  if (!auth.ok) return apiError(auth.code, auth.message, auth.status);

  const cred = await getNgeCredential(auth.gameId);
  if (!cred) return apiError("NO_CREDENTIAL", "Este juego todavía no tiene credencial NGE emitida", 404);
  return apiOk({ ...cred, envVar: "NGE_CONNECTION" });
}
