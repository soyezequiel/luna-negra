import { nip19 } from "nostr-tools";
import { verifyEntitlement } from "@/lib/auth";
import { verifyApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { submitScore } from "@/lib/leaderboard";
import { trackIntegration } from "@/lib/integration-telemetry";
import { capMode } from "@/lib/capability-mode";
import { apiOk, apiError, corsPreflight, bearerToken } from "@/lib/api";

// Subir un puntaje al marcador. Dos formas de auth:
//
//   A) Bearer <entitlement>  — el jugador sube SU propio puntaje (gameId y npub
//      salen del token).  body { score }
//   B) Bearer ln_sk_…        — el game server sube el puntaje EN NOMBRE de un
//      jugador con la API key del proveedor.  body { gameId, npub, score }
//      El proveedor solo puede escribir en marcadores de SUS juegos.
//
//   POST /api/v1/leaderboards/{name}/scores
//   → { score, rank, improved }  (se queda el mejor: improved=false si no superó)
//
// ⚠️ El puntaje es FALSIFICABLE en ambos caminos: sirve para mostrar rankings
// (como Steam), NO para resolver apuestas (eso viene del game server por
// POST /api/v1/bets/{id}/result).
export function OPTIONS() {
  return corsPreflight();
}

function isValidNpub(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("npub1")) return false;
  try {
    return nip19.decode(value).type === "npub";
  } catch {
    return false;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    score?: unknown;
    gameId?: unknown;
    npub?: unknown;
  };

  // A) Entitlement del jugador: identidad y juego salen del token.
  const ent = await verifyEntitlement(bearerToken(req) ?? "");
  let gameId: string;
  let npub: string;
  if (ent) {
    gameId = ent.gameId;
    npub = ent.npub;
  } else {
    // B) API key del proveedor: sube en nombre de un npub. Exige { gameId, npub }
    // y valida que el juego sea del proveedor dueño de la key.
    const providerId = await verifyApiKey(req);
    if (!providerId) {
      return apiError("INVALID_TOKEN", "Token inválido o expirado", 401);
    }
    if (typeof body.gameId !== "string" || !body.gameId) {
      return apiError("MISSING_GAME_ID", "`gameId` es obligatorio al usar API key", 400);
    }
    if (!isValidNpub(body.npub)) {
      return apiError("INVALID_NPUB", "`npub` inválido", 400);
    }
    const game = await prisma.game.findUnique({
      where: { id: body.gameId },
      select: { id: true, providerId: true },
    });
    if (!game) return apiError("GAME_NOT_FOUND", "Juego no encontrado", 404);
    if (game.providerId !== providerId) {
      return apiError("NOT_GAME_OWNER", "El juego no es de tu proveedor", 403);
    }
    gameId = game.id;
    npub = body.npub;
  }

  // Marcador migrado a Nostr: la pata Luna (subir puntaje por REST) queda apagada.
  // El puntaje debe venir como kind:31337 firmado por el jugador (score-sync lo
  // proyecta a la tabla Score). Leer el ranking (GET) sigue funcionando.
  const scoreGame = await prisma.game.findUnique({
    where: { id: gameId },
    select: { capsMode: true },
  });
  if (capMode(scoreGame?.capsMode, "marcador") === "nostr") {
    return apiError(
      "CAPABILITY_MIGRATED",
      "El marcador está migrado a Nostr (kind:31337) para este juego: subí el puntaje como evento firmado por el jugador",
      409,
    );
  }

  const result = await submitScore(gameId, name, npub, body.score);
  if (!result.ok) {
    return apiError(result.code, result.message, result.status);
  }
  trackIntegration("leaderboards", { gameId });
  return apiOk(
    { score: result.score, rank: result.rank, improved: result.improved },
    { "Cache-Control": "no-store" },
  );
}
