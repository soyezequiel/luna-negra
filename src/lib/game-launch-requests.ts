import { prisma } from "@/lib/prisma";
import { mintRoomInvite } from "@/lib/rooms";

const LAUNCH_REQUEST_TTL_MS = 120_000;
const LAUNCH_LISTENER_TTL_MS = 20_000;

export type GameLaunchRequestKind = "luna-room" | "room-link";

export type GameLaunchRequestPayload = {
  id: string;
  roomId: string;
  inviteToken: string;
  kind: GameLaunchRequestKind;
  slug: string;
  title: string;
  gameUrl: string;
};

export async function createGameLaunchRequest(input: {
  providerId: string;
  npub: string;
  roomId: string;
  inviteToken: string;
  kind?: GameLaunchRequestKind;
  slug: string;
  title: string;
  gameUrl: string;
}): Promise<void> {
  const now = new Date();
  await prisma.gameLaunchRequest.create({
    data: {
      providerId: input.providerId,
      npub: input.npub,
      roomId: input.roomId,
      inviteToken: input.inviteToken,
      kind: input.kind ?? "luna-room",
      slug: input.slug,
      title: input.title,
      gameUrl: input.gameUrl,
      expiresAt: new Date(now.getTime() + LAUNCH_REQUEST_TTL_MS),
    },
  });

  await prisma.gameLaunchRequest
    .deleteMany({
      where: { providerId: input.providerId, expiresAt: { lt: now } },
    })
    .catch(() => {});
}

export async function queueGameLaunchRequest(input: {
  providerId: string;
  user: { id: string; npub: string; pubkey: string };
  roomId: string;
  gameId: string;
}): Promise<boolean> {
  if (!input.gameId) return false;

  // Optimización best-effort: si el invitado ya tiene el juego abierto, lo
  // mandamos a la sala sin abrir otra pestaña. NUNCA debe hacer fallar la
  // invitación que la origina (la fila GameInvite ya se persistió y el toast/SSE
  // es el canal principal). Cualquier error acá —p. ej. LN_SIGNING_JWK sin
  // configurar al firmar el invite token— se traga y se reporta como "no
  // encolado" en vez de tumbar todo el POST con un 500.
  try {
    const game = await prisma.game.findFirst({
      where: {
        id: input.gameId,
        providerId: input.providerId,
        status: "published",
        gameUrl: { not: null },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        gameUrl: true,
      },
    });
    if (!game?.gameUrl) return false;

    const invite = await mintRoomInvite(
      { sub: input.user.id, npub: input.user.npub, pubkey: input.user.pubkey },
      game.id,
      input.roomId,
    );
    if (!invite.ok) return false;

    await createGameLaunchRequest({
      providerId: input.providerId,
      npub: input.user.npub,
      roomId: invite.roomId,
      inviteToken: invite.token,
      slug: invite.slug,
      title: game.title,
      gameUrl: game.gameUrl,
    });
    return true;
  } catch (error) {
    console.error("queueGameLaunchRequest failed (invite still sent)", error);
    return false;
  }
}

/**
 * Encola el popup para un "Luna Room Link" ya firmado. A diferencia de
 * `queueGameLaunchRequest`, no mintea una sala de Luna: conserva el `lnInvite` y
 * la URL del juego para que el cliente entre a su propia sala `lnRoom`.
 *
 * La entrega por DM sigue siendo el canal principal; por eso un fallo al encolar
 * nunca debe romper la creación del enlace.
 */
export async function queueRoomLinkLaunchRequest(input: {
  providerId: string;
  npub: string;
  roomId: string;
  lnInvite: string;
  slug: string;
  title: string;
  inviteUrl: string;
}): Promise<boolean> {
  try {
    await createGameLaunchRequest({
      providerId: input.providerId,
      npub: input.npub,
      roomId: input.roomId,
      inviteToken: input.lnInvite,
      kind: "room-link",
      slug: input.slug,
      title: input.title,
      gameUrl: input.inviteUrl,
    });
    return true;
  } catch (error) {
    console.error("queueRoomLinkLaunchRequest failed (room link still created)", error);
    return false;
  }
}

export async function recordGameLaunchListener(input: {
  providerId: string;
  npub: string;
}): Promise<void> {
  const now = new Date();
  await prisma.gameLaunchListener.upsert({
    where: { providerId_npub: { providerId: input.providerId, npub: input.npub } },
    create: {
      providerId: input.providerId,
      npub: input.npub,
      expiresAt: new Date(now.getTime() + LAUNCH_LISTENER_TTL_MS),
    },
    update: {
      expiresAt: new Date(now.getTime() + LAUNCH_LISTENER_TTL_MS),
    },
  });

  await prisma.gameLaunchListener
    .deleteMany({ where: { providerId: input.providerId, expiresAt: { lt: now } } })
    .catch(() => {});
}

export async function hasGameLaunchListener(input: {
  providerId: string;
  npub: string;
}): Promise<boolean> {
  const listener = await prisma.gameLaunchListener.findFirst({
    where: {
      providerId: input.providerId,
      npub: input.npub,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return Boolean(listener);
}

export async function consumeGameLaunchRequest(input: {
  providerId: string;
  npub: string;
}): Promise<GameLaunchRequestPayload | null> {
  const now = new Date();
  const request = await prisma.gameLaunchRequest.findFirst({
    where: {
      providerId: input.providerId,
      npub: input.npub,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      roomId: true,
      inviteToken: true,
      kind: true,
      slug: true,
      title: true,
      gameUrl: true,
    },
  });
  if (!request) return null;

  const consumed = await prisma.gameLaunchRequest.updateMany({
    where: { id: request.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) return null;
  return {
    ...request,
    // La columna es String para mantener el esquema extensible; el contrato
    // público sólo expone los dos modos que el juego sabe procesar.
    kind: request.kind === "room-link" ? "room-link" : "luna-room",
  };
}
