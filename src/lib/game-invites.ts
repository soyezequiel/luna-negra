import { prisma } from "@/lib/prisma";

export type PendingGameInvite = {
  id: string;
  fromNpub: string;
  roomId: string;
  inviteUrl: string;
  createdAt: Date;
};

// Lee las invitaciones a sala no vistas del usuario y las marca como vistas
// (entrega única, toast una sola vez). Lo comparten el endpoint de polling
// (GET /api/invites) y el stream SSE (GET /api/invites/stream).
export async function consumePendingInvites(
  npub: string,
): Promise<PendingGameInvite[]> {
  const pending = await prisma.gameInvite.findMany({
    where: { toNpub: npub, seenAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      fromNpub: true,
      roomId: true,
      inviteUrl: true,
      createdAt: true,
    },
  });

  if (pending.length) {
    await prisma.gameInvite
      .updateMany({
        where: { id: { in: pending.map((i) => i.id) } },
        data: { seenAt: new Date() },
      })
      .catch(() => {});
  }

  return pending;
}
