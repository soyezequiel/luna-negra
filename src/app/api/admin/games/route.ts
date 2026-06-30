import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin, ADMIN_ONLY_STATUS } from "@/lib/admin";

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const [games, unannounced, published, hidden] = await Promise.all([
    prisma.game.findMany({
      where: { status: "in_review" },
      include: { provider: true },
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
    // Juegos ocultos (solo admin): publicados de forma privada, fuera del catálogo.
    prisma.game.findMany({
      where: { status: ADMIN_ONLY_STATUS },
      include: { provider: true },
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
  }));
  const adminOnly = hidden.map((g) => ({
    id: g.id,
    title: g.title,
    slug: g.slug,
    priceSats: g.priceSats,
    provider: { name: g.provider.name },
  }));
  return NextResponse.json({ games, unannounced, catalog, adminOnly });
}
