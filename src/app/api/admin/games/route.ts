import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const [games, drafts, unannounced, published] = await Promise.all([
    prisma.game.findMany({
      where: { status: "in_review" },
      include: { provider: true },
      orderBy: { createdAt: "asc" },
    }),
    // Borradores que no estan en la cola de revision. Incluimos al dueno para
    // que el admin pueda detectar fichas que pudieron quedar olvidadas.
    prisma.game.findMany({
      where: { status: "draft" },
      select: {
        id: true,
        title: true,
        slug: true,
        priceSats: true,
        description: true,
        categories: true,
        gameUrl: true,
        coverUrl: true,
        horizontalCoverUrl: true,
        createdAt: true,
        provider: {
          select: {
            name: true,
            owner: { select: { displayName: true, npub: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Publicados sin anuncio raíz en Nostr (para re-anunciar).
    prisma.game.findMany({
      where: { status: "published", nostrEventId: null },
      include: { provider: true },
      orderBy: { createdAt: "asc" },
    }),
    // Catálogo publicado, para poder borrar juegos (con nº de dueños).
    prisma.game.findMany({
      where: { status: "published" },
      include: {
        provider: true,
        _count: { select: { purchases: { where: { status: "paid" } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const catalog = published.map((g) => ({
    id: g.id,
    title: g.title,
    slug: g.slug,
    priceSats: g.priceSats,
    revenueShare: g.revenueShare,
    provider: { name: g.provider.name },
    owners: g._count.purchases,
    isBeta: g.isBeta,
  }));
  return NextResponse.json({ games, drafts, unannounced, catalog });
}
