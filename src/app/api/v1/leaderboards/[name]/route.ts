import { verifyEntitlement } from "@/lib/auth";
import { readLeaderboard } from "@/lib/leaderboard";
import { recordIntegration } from "@/lib/integration-telemetry";
import { apiOk, apiError, corsPreflight, bearerToken } from "@/lib/api";

// Leer un marcador. Auth: Authorization: Bearer <entitlement> (lnToken del juego).
//   GET /api/v1/leaderboards/{name}?window=all|week&view=top|around&npub=
//   → { entries: [{ npub, displayName, score, rank }] }
// ⚠️ Los puntajes los manda el cliente y son FALSIFICABLES: sirven para mostrar
// rankings, NO para resolver apuestas.
export function OPTIONS() {
  return corsPreflight();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const ent = await verifyEntitlement(bearerToken(req) ?? "");
  if (!ent) {
    return apiError("INVALID_TOKEN", "Token inválido o expirado", 401);
  }

  const url = new URL(req.url);
  const window = url.searchParams.get("window") === "week" ? "week" : "all";
  const view = url.searchParams.get("view") === "around" ? "around" : "top";
  const npub = url.searchParams.get("npub")?.trim() || null;

  const { entries } = await readLeaderboard(ent.gameId, name, { window, view, npub });
  void recordIntegration("leaderboards", { gameId: ent.gameId });
  return apiOk({ entries }, { "Cache-Control": "no-store" });
}
