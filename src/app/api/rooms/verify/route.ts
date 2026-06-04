import { verifyInvite } from "@/lib/auth";
import {
  apiOk,
  apiError,
  corsPreflight,
  bearerToken,
  deprecatedHeaders,
} from "@/lib/api";

// DEPRECADO → usar GET /api/v1/rooms/verify (Authorization: Bearer).
// Sigue aceptando ?token= por compatibilidad.
const DEP = deprecatedHeaders("/api/v1/rooms/verify");

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return apiError("MISSING_TOKEN", "Falta el token de invitación", 400, DEP);
  }
  const inv = await verifyInvite(token);
  if (!inv) {
    return apiOk({ valid: false }, DEP);
  }
  return apiOk(
    {
      valid: true,
      npub: inv.npub,
      gameId: inv.gameId,
      slug: inv.slug,
      roomId: inv.roomId,
      host: inv.host,
    },
    DEP,
  );
}
