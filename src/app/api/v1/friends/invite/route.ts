import { verifyApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { pubkeyFromNpub, npubOf } from "@/lib/nostr-social";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { queueGameLaunchRequest } from "@/lib/game-launch-requests";

// Invitar a un amigo a una sala. Luna Negra persiste la invitación y se la muestra
// al invitado dentro de la tienda (toast in-app, vía GET /api/invites + polling).
// Auth: Authorization: Bearer <API_KEY> (ln_sk_…).
export function OPTIONS() {
  return corsPreflight();
}

const HTTP_URL_RE = /^https?:\/\//;
const INVITE_TTL_MS = 3_600_000; // 1h

export async function POST(req: Request) {
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);
  }

  const body = (await req.json().catch(() => ({}))) as {
    fromNpub?: unknown;
    toNpub?: unknown;
    roomId?: unknown;
    inviteUrl?: unknown;
    gameId?: unknown;
  };
  const fromPubkey = pubkeyFromNpub(String(body.fromNpub ?? ""));
  const toPubkey = pubkeyFromNpub(String(body.toNpub ?? ""));
  if (!fromPubkey || !toPubkey) {
    return apiError("INVALID_NPUB", "`fromNpub`/`toNpub` inválidos", 400);
  }
  const roomId = String(body.roomId ?? "").slice(0, 64);
  if (!roomId) {
    return apiError("MISSING_ROOM", "Falta `roomId`", 400);
  }
  const inviteUrl = String(body.inviteUrl ?? "").trim();
  if (!HTTP_URL_RE.test(inviteUrl)) {
    return apiError("INVALID_INVITE_URL", "`inviteUrl` debe empezar con http(s)://", 400);
  }

  const toNpub = npubOf(toPubkey);
  await prisma.gameInvite.create({
    data: {
      providerId,
      fromNpub: npubOf(fromPubkey),
      toNpub,
      roomId,
      inviteUrl,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  // delivered = el invitado es un usuario conocido de Luna Negra (entonces se lo
  // mostramos in-app). Si no, false → el juego copia el link al portapapeles.
  const known = await prisma.user.findUnique({
    where: { npub: toNpub },
    select: { id: true, npub: true, pubkey: true },
  });
  const launchQueued = known
    ? await queueGameLaunchRequest({
        providerId,
        user: known,
        roomId,
        gameId: typeof body.gameId === "string" ? body.gameId.trim() : "",
      })
    : false;
  return apiOk({ delivered: !!known, launchQueued });
}
