import { prisma } from "@/lib/prisma";

const LAUNCH_REQUEST_TTL_MS = 120_000;
const LAUNCH_LISTENER_TTL_MS = 20_000;

export type GameLaunchRequestPayload = {
  id: string;
  roomId: string;
  inviteToken: string;
  slug: string;
  title: string;
  gameUrl: string;
};

export async function createGameLaunchRequest(input: {
  providerId: string;
  npub: string;
  roomId: string;
  inviteToken: string;
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
  return consumed.count === 1 ? request : null;
}
