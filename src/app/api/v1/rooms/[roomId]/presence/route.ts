import { after } from "next/server";
import { resolvePresence } from "@/lib/rooms";
import { cacheProfile } from "@/lib/profile-cache";
import { apiOk, apiError, corsPreflight, bearerToken } from "@/lib/api";

// Heartbeat + roster de una sala multijugador.
// Auth: Authorization: Bearer <invite token>. clientId/score/leave en el body.
export function OPTIONS() {
  return corsPreflight();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const token = bearerToken(req);
  const body = await req.json().catch(() => ({}));

  const result = await resolvePresence(roomId, {
    inviteToken: token,
    clientId: body.clientId,
    score: body.score,
    leave: body.leave,
  });
  if (!result.ok) {
    return apiError(result.code, result.message, result.status);
  }

  // Resolver nombre/avatar faltantes en background (no frena la respuesta).
  if (result.missingPubkeys.length) {
    after(() =>
      Promise.allSettled(result.missingPubkeys.map(cacheProfile)).then(
        () => undefined,
      ),
    );
  }

  return apiOk({ members: result.members, closed: result.closed });
}
