import { verifyEntitlement } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trackIntegration } from "@/lib/integration-telemetry";
import { purchaseVerificationDisabled } from "@/lib/capability-mode";
import { apiOk, apiError, corsPreflight, bearerToken } from "@/lib/api";

// Introspección del token de acceso (entitlement) emitido por Luna Negra.
// Auth: Authorization: Bearer <token>. Público (CORS abierto): lo llama el juego.
//
// Acceso abierto: si el proveedor desactivó "Verificar compra" para el juego, éste
// deja de requerir compra. Como el juego puede no tener token, se identifica con
// ?game=<slug|id>: sin entitlement válido pero con la verificación desactivada, se
// responde valid:true (bypassed) para cualquiera. Ver src/lib/capability-mode.ts.
export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  const ent = token ? await verifyEntitlement(token) : null;

  // Entitlement válido → acceso confirmado (comportamiento de siempre).
  if (ent) {
    trackIntegration("purchase", { gameId: ent.gameId });
    return apiOk({
      valid: true,
      npub: ent.npub,
      gameId: ent.gameId,
      slug: ent.slug,
    });
  }

  // Sin entitlement válido: ¿el juego tiene la verificación desactivada (acceso
  // abierto)? Se identifica por ?game=<slug|id> porque acá no hay token que lo diga.
  const gameRef = new URL(req.url).searchParams.get("game");
  if (gameRef) {
    const game = await prisma.game.findFirst({
      where: { OR: [{ slug: gameRef }, { id: gameRef }] },
      select: { id: true, slug: true, capsMode: true },
    });
    if (game && purchaseVerificationDisabled(game.capsMode)) {
      trackIntegration("purchase", { gameId: game.id });
      return apiOk({ valid: true, bypassed: true, gameId: game.id, slug: game.slug });
    }
  }

  if (!token) {
    return apiError(
      "MISSING_TOKEN",
      "Falta el token de acceso (Authorization: Bearer …)",
      400,
    );
  }
  // Token bien formado pero inválido/expirado → respuesta de introspección.
  return apiOk({ valid: false });
}
