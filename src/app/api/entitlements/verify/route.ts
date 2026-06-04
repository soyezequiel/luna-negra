import { verifyEntitlement } from "@/lib/auth";
import {
  apiOk,
  apiError,
  corsPreflight,
  bearerToken,
  deprecatedHeaders,
} from "@/lib/api";

// DEPRECADO → usar GET /api/v1/entitlements/verify (Authorization: Bearer).
// Sigue aceptando ?token= por compatibilidad.
const DEP = deprecatedHeaders("/api/v1/entitlements/verify");

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return apiError("MISSING_TOKEN", "Falta el token de acceso", 400, DEP);
  }
  const ent = await verifyEntitlement(token);
  if (!ent) {
    return apiOk({ valid: false }, DEP);
  }
  return apiOk(
    { valid: true, npub: ent.npub, gameId: ent.gameId, slug: ent.slug },
    DEP,
  );
}
