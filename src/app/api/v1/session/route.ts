import { after } from "next/server";
import { verifyEntitlementDetailed } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cacheProfile } from "@/lib/profile-cache";
import { trackIntegration } from "@/lib/integration-telemetry";
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
  trackIntegration("sso", { gameId: ent.gameId });

  return apiOk({
    npub: ent.npub,
    pubkey: ent.pubkey,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    gameId: ent.gameId,
  });
}
