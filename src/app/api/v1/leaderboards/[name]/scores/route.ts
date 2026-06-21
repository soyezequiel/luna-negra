import { verifyEntitlement } from "@/lib/auth";
import { submitScore } from "@/lib/leaderboard";
import { recordIntegration } from "@/lib/integration-telemetry";
import { apiOk, apiError, corsPreflight, bearerToken } from "@/lib/api";

// Subir un puntaje al marcador. Auth: Authorization: Bearer <entitlement>.
//   POST /api/v1/leaderboards/{name}/scores  body { score }
//   → { score, rank, improved }  (se queda el mejor: improved=false si no superó)
// ⚠️ El puntaje lo manda el cliente y es FALSIFICABLE: sirve para mostrar
// rankings (como Steam), NO para resolver apuestas (eso viene del game server
// por POST /api/v1/bets/{id}/result).
export function OPTIONS() {
  return corsPreflight();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const ent = await verifyEntitlement(bearerToken(req) ?? "");
  if (!ent) {
    return apiError("INVALID_TOKEN", "Token inválido o expirado", 401);
  }

  const body = await req.json().catch(() => ({}));
  const result = await submitScore(ent.gameId, name, ent.npub, (body as { score?: unknown })?.score);
  if (!result.ok) {
    return apiError(result.code, result.message, result.status);
  }
  void recordIntegration("leaderboards", { gameId: ent.gameId });
  return apiOk(
    { score: result.score, rank: result.rank, improved: result.improved },
    { "Cache-Control": "no-store" },
  );
}
