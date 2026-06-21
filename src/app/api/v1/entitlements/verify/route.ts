import { verifyEntitlement } from "@/lib/auth";
import { recordIntegration } from "@/lib/integration-telemetry";
import { apiOk, apiError, corsPreflight, bearerToken } from "@/lib/api";

// Introspección del token de acceso (entitlement) emitido por Luna Negra.
// Auth: Authorization: Bearer <token>. Público (CORS abierto): lo llama el juego.
export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return apiError(
      "MISSING_TOKEN",
      "Falta el token de acceso (Authorization: Bearer …)",
      400,
    );
  }
  const ent = await verifyEntitlement(token);
  if (!ent) {
    // Token bien formado pero inválido/expirado → respuesta de introspección.
    return apiOk({ valid: false });
  }
  void recordIntegration("purchase", { gameId: ent.gameId });
  return apiOk({
    valid: true,
    npub: ent.npub,
    gameId: ent.gameId,
    slug: ent.slug,
  });
}
