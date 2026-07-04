import { prisma } from "@/lib/prisma";

export type PendingGameInvite = {
  id: string;
  fromNpub: string;
  roomId: string;
  inviteUrl: string;
  /** Nombre del juego (proveedor) para mostrar en la invitación. */
  game: string;
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
      provider: { select: { name: true } },
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

  // El título real del juego vive en Game.title. El `inviteUrl` first-party lleva
  // `/game/<slug>?room=…`, así que resolvemos el título por slug (más preciso que
  // el nombre del proveedor). Si la URL es externa o el juego no está, caemos al
  // nombre del proveedor.
  const slugs = pending
    .map((i) => slugFromInviteUrl(i.inviteUrl))
    .filter((s): s is string => !!s);
  const titleBySlug = new Map<string, string>();
  if (slugs.length) {
    const games = await prisma.game.findMany({
      where: { slug: { in: [...new Set(slugs)] } },
      select: { slug: true, title: true },
    });
    for (const g of games) titleBySlug.set(g.slug, g.title);
  }

  return pending.map(({ provider, ...inv }) => {
    const slug = slugFromInviteUrl(inv.inviteUrl);
    const game =
      (slug ? titleBySlug.get(slug) : undefined) ?? provider?.name ?? "un juego";
    return { ...inv, game };
  });
}

/** Extrae el slug de `/game/<slug>?…` de una inviteUrl first-party (o null). */
function slugFromInviteUrl(url: string): string | null {
  const m = /\/game\/([a-z0-9-]+)/i.exec(url);
  return m ? m[1] : null;
}
