import { after } from "next/server";
import { verifyEntitlementDetailed } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cacheProfile } from "@/lib/profile-cache";
import { trackIntegration } from "@/lib/integration-telemetry";
import { capMode } from "@/lib/capability-mode";
import { apiOk, apiError, corsPreflight, bearerToken } from "@/lib/api";

// Login SSO: el juego se abre desde Luna Negra con `?lnToken=<token>` (que es el
// entitlement JWT que mintea POST /api/games/[id]/sessions). Este endpoint canjea
// ese token por la identidad del jugador.
// Auth: Authorization: Bearer <lnToken>. Público (CORS abierto): lo llama el juego.
export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return apiError(
      "MISSING_TOKEN",
      "Falta el token de sesión (Authorization: Bearer …)",
      400,
    );
  }
  const result = await verifyEntitlementDetailed(token);
  if (!result.ok) {
    // Motivo REAL (vencido / firma / emisor) en vez de un 401 genérico, para que la puerta
    // de login del juego pueda decirle al jugador por qué falló.
    return apiError(result.error.code, result.error.message, 401);
  }
  const ent = result.payload;

  // Nombre/avatar (kind:0 cacheado); si falta, refrescar en background.
  const user = await prisma.user.findUnique({
    where: { pubkey: ent.pubkey },
    select: { displayName: true, avatarUrl: true },
  });
  if (user && (!user.displayName || !user.avatarUrl)) {
    after(() => cacheProfile(ent.pubkey).then(() => undefined));
  }

  // Coordenada NIP-23 del juego (`30023:<tienda>:<slug>`): el ancla del marcador
  // 2.0. Con ella el juego firma su propio kind:31337 (Camino A). null si el
  // juego aún no se publicó (sin artículo → sin coordenada). Ver
  // docs/perfil-juego-nostr.md.
  const game = await prisma.game.findUnique({
    where: { id: ent.gameId },
    select: { slug: true, nostrCoord: true, capsMode: true },
  });
  // Si el login de este juego está migrado a la interfaz Nostr, la pata Luna (canje
  // de lnToken) queda apagada: el juego debe identificar al jugador con NIP-07/46.
  if (capMode(game?.capsMode, "identidad") === "nostr") {
    return apiError(
      "CAPABILITY_MIGRATED",
      "El login por Luna está migrado a Nostr (NIP-07/46) para este juego",
      409,
    );
  }
  trackIntegration("sso", { gameId: ent.gameId });

  return apiOk({
    npub: ent.npub,
    pubkey: ent.pubkey,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    gameId: ent.gameId,
    slug: game?.slug ?? null,
    gameCoord: game?.nostrCoord ?? null,
  });
}
