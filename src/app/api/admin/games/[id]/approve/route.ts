import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { syncGameToNostr } from "@/lib/announce-game";
import { broadcastProviderArticle } from "@/lib/provider-article";
import { revalidateCatalog } from "@/lib/store-catalog";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.game.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  // Régimen "provider": el artículo lo firma el proveedor; sin su firma guardada
  // no hay nada que difundir, así que la aprobación se bloquea (el proveedor
  // firma desde su panel y recién entonces se puede aprobar-publicar).
  if (existing.articleSigner === "provider" && !existing.signedArticle) {
    return NextResponse.json(
      {
        error:
          "Falta la firma del proveedor: pedile que firme el artículo desde su panel antes de aprobar",
      },
      { status: 400 },
    );
  }
  let game = await prisma.game.update({
    where: { id },
    data: { status: "published" },
  });
  // Publica el artículo NIP-23 del juego en Nostr (fuente de verdad) y cachea su
  // identidad en la DB. Best-effort: si falla, el juego queda publicado igual
  // (cae en "Sin anuncio" y se reintenta con re-anunciar).
  // - "provider": difunde el evento YA FIRMADO por el proveedor tal cual.
  // - "store" (legacy): firma con la clave de la tienda como siempre.
  if (game.articleSigner === "provider") {
    game = await broadcastProviderArticle(game);
  } else {
    game = await syncGameToNostr(game, req);
  }
  // Refresca el catálogo cacheado (Home + ficha) al instante.
  revalidateCatalog();
  return NextResponse.json({ game });
}
