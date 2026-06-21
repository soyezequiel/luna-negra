import { verifyInvite } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordIntegration } from "@/lib/integration-telemetry";
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

  // Nombre/avatar (kind:0 cacheado) son solo presentación, no identidad.
  const user = await prisma.user.findUnique({
    where: { pubkey: inv.pubkey },
    select: { displayName: true, avatarUrl: true },
  });

  void recordIntegration("rooms", { gameId: inv.gameId });
  return apiOk({
    valid: true,
    npub: inv.npub,
    pubkey: inv.pubkey,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    gameId: inv.gameId,
    slug: inv.slug,
    roomId: inv.roomId,
    host: inv.host,
    hostNpub: inv.hostNpub,
    hostPubkey: inv.hostPubkey,
    expiresAt: inv.expiresAt,
  });
}
