import { verifyApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { pubkeyFromNpub, npubOf } from "@/lib/nostr-social";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";
import {
  npubHasProviderEntitlement,
  npubHasLivePresence,
  providerGameHosts,
} from "@/lib/provider-entitlement";
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

const INVITE_TTL_MS = 3_600_000; // 1h

const BAD_KEY = () =>
  apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);

/**
 * ¿La `inviteUrl` es un destino legítimo? Solo aceptamos una URL first-party de
 * Luna Negra (`…/game/…`) o el host de un juego publicado del propio proveedor.
 * Así un proveedor no puede hacer que el toast de invitación abra un sitio
 * externo arbitrario (phishing/open-redirect).
 */
function isAllowedInviteUrl(
  inviteUrl: string,
  req: Request,
  providerHosts: Set<string>,
): boolean {
  let u: URL;
  try {
    u = new URL(inviteUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.host.toLowerCase();
  try {
    const siteHost = new URL(siteUrl(req)).host.toLowerCase();
    if (host === siteHost && u.pathname.startsWith("/game/")) return true;
  } catch {
    /* siteUrl mal formada → seguimos con la allowlist del proveedor */
  }
  return providerHosts.has(host);
}

export async function GET(req: Request) {
  const providerId = await verifyApiKey(req);
  if (!providerId) return BAD_KEY();

  const rl = await checkRateLimit(`invite-get:${providerId}`, 120, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
  }

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

  const rl = await checkRateLimit(`invite:${providerId}`, 60, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
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
  const hosts = await providerGameHosts(providerId);
  if (!isAllowedInviteUrl(inviteUrl, req, hosts)) {
    return apiError(
      "INVALID_INVITE_URL",
      "`inviteUrl` debe ser una URL de Luna Negra (/game/…) o del dominio de tu juego",
      400,
    );
  }

  const fromNpub = npubOf(fromPubkey);
  const toNpub = npubOf(toPubkey);

  // El invitador no es spoofeable: tiene que ser un jugador real de este
  // proveedor (con presencia viva o acceso a alguno de sus juegos). Evita que un
  // proveedor mande invitaciones haciéndose pasar por identidades arbitrarias.
  const fromOk =
    (await npubHasLivePresence(fromNpub, providerId)) ||
    (await npubHasProviderEntitlement(fromNpub, providerId));
  if (!fromOk) {
    return apiError(
      "FROM_NOT_PLAYER",
      "`fromNpub` debe ser un jugador de este proveedor",
      403,
    );
  }

  // Tope por destinatario: que un proveedor no spamee el buzón de un usuario.
  const rlTo = await checkRateLimit(`invite-to:${providerId}:${toNpub}`, 5, 600_000);
  if (!rlTo.success) {
    return apiError("RATE_LIMITED", "Demasiadas invitaciones a ese jugador", 429, rateLimitHeaders(rlTo));
  }

  await prisma.gameInvite.create({
    data: {
      providerId,
      fromNpub,
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
