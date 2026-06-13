import { verifyApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { pubkeyFromNpub, npubOf } from "@/lib/nostr-social";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import {
  queueGameLaunchRequest,
  consumeGameLaunchRequest,
  recordGameLaunchListener,
} from "@/lib/game-launch-requests";

// Invitaciones a sala (recurso unificado). Reemplaza a /friends/invite + /launch-requests.
// Auth: Authorization: Bearer <API_KEY> (ln_sk_…).
//
//   POST       → crear una invitación: { fromNpub, toNpub, roomId, inviteUrl, gameId? }.
//                Luna Negra notifica al invitado (toast in-app) y, si está jugando,
//                le encola la orden de entrada a la sala. → { delivered, launchQueued }.
//   GET ?npub= → el juego abierto consume la orden de entrada pendiente del jugador
//                (también registra que está escuchando). → { request }.
export function OPTIONS() {
  return corsPreflight();
}

const HTTP_URL_RE = /^https?:\/\//;
const INVITE_TTL_MS = 3_600_000; // 1h

const BAD_KEY = () =>
  apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);

export async function GET(req: Request) {
  const providerId = await verifyApiKey(req);
  if (!providerId) return BAD_KEY();

  const url = new URL(req.url);
  const pubkey = pubkeyFromNpub(url.searchParams.get("npub") ?? "");
  if (!pubkey) {
    return apiError("INVALID_NPUB", "Falta o es inválido `npub`", 400);
  }

  const npub = npubOf(pubkey);
  await recordGameLaunchListener({ providerId, npub });
  const request = await consumeGameLaunchRequest({ providerId, npub });
  return apiOk({ request });
}

export async function POST(req: Request) {
  const providerId = await verifyApiKey(req);
  if (!providerId) return BAD_KEY();

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
