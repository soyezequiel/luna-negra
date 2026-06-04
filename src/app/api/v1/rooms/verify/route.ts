import { verifyInvite } from "@/lib/auth";
import { apiOk, apiError, corsPreflight, bearerToken } from "@/lib/api";

// Introspección del invite token de sala multijugador.
// Auth: Authorization: Bearer <token>. Público (CORS abierto): lo llama el lobby.
export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return apiError(
      "MISSING_TOKEN",
      "Falta el token de invitación (Authorization: Bearer …)",
      400,
    );
  }
  const inv = await verifyInvite(token);
  if (!inv) {
    return apiOk({ valid: false });
  }
  return apiOk({
    valid: true,
    npub: inv.npub,
    gameId: inv.gameId,
    slug: inv.slug,
    roomId: inv.roomId,
    host: inv.host,
  });
}
