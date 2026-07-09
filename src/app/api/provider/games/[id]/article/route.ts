import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownedGame } from "@/lib/provider";
import { revalidateCatalog } from "@/lib/store-catalog";
import {
  broadcastProviderArticle,
  checkProviderArticle,
} from "@/lib/provider-article";

/**
 * Recibe el artículo NIP-23 RE-FIRMADO por el proveedor (régimen
 * `articleSigner === "provider"`). Dos situaciones:
 *
 * - Juego draft/in_review: repone una firma pendiente (p.ej. invalidada por una
 *   edición posterior al submit). Se guarda SIN publicar; el admin difunde al
 *   aprobar.
 * - Juego published: firma-y-difunde los cambios de la ficha (articleDirty). El
 *   server no puede re-firmar por el proveedor, así que este POST es el único
 *   camino para que la edición llegue a Nostr. Si ningún relay acepta, la firma
 *   queda retenida y el admin puede reintentar con "re-anunciar".
 */
export async function POST(
  req: Request,
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
  if (owned.game.articleSigner !== "provider") {
    return NextResponse.json(
      { error: "Este juego lo firma la tienda: no acepta firmas del proveedor" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const check = await checkProviderArticle({
    game: owned.game,
    provider: owned.provider,
    sessionPubkey: session.pubkey,
    signedEvent: body.signedEvent,
    req,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  // Guardamos la firma SIEMPRE; si el juego está publicado, intentamos difundir
  // ya (broadcastProviderArticle limpia signedArticle/articleDirty solo si algún
  // relay aceptó — si no, la firma queda retenida para reintentar).
  let game = await prisma.game.update({
    where: { id },
    data: { signedArticle: check.event as unknown as Prisma.InputJsonValue },
  });
  let accepted = false;
  if (game.status === "published") {
    const updated = await broadcastProviderArticle(game);
    accepted = updated.nostrEventId === check.event.id;
    game = updated;
    revalidateCatalog();
  }

  return NextResponse.json({ game, broadcast: accepted });
}
