import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownedGame } from "@/lib/provider";
import { uniqueGameSlug } from "@/lib/slug";

// Duplica un juego del proveedor: crea una copia en BORRADOR con todos los datos
// editables (ficha, media, precio, reparto, overrides). NO copia identidad en
// Nostr ni nada transaccional (compras, reseñas, apuestas, zaps, comentarios):
// la copia arranca limpia, como un juego nuevo, y se publica por su cuenta.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await ownedGame(session, id);
  if (!owned) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  const src = owned.game;
  const title = `${src.title} (copia)`;

  const copy = await prisma.game.create({
    data: {
      providerId: src.providerId,
      slug: await uniqueGameSlug(title),
      title,
      description: src.description,
      categories: src.categories,
      priceSats: src.priceSats,
      coverUrl: src.coverUrl,
      horizontalCoverUrl: src.horizontalCoverUrl,
      screenshots: src.screenshots,
      videos: src.videos,
      gameUrl: src.gameUrl,
      isBeta: src.isBeta,
      revenueShare: src.revenueShare,
      betFeePct: src.betFeePct,
      betDevFeePct: src.betDevFeePct,
      // Arranca como borrador, sin identidad Nostr ni firmante de zaps: la copia
      // publica su propio artículo recién cuando se aprueba/publica. Como todo
      // juego nuevo, nace en el régimen "provider" (el proveedor firma el
      // artículo), aunque el original fuera legacy firmado por la tienda.
      status: "draft",
      articleSigner: "provider",
    },
  });

  return NextResponse.json({ game: copy });
}
