import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownedGame } from "@/lib/provider";
import { revalidateCatalog } from "@/lib/store-catalog";
import { gameArticleCoord } from "@/lib/game-article";
import {
  broadcastSignedEvent,
  publishStoreArticleDeletion,
} from "@/lib/nostr-server";
import { checkProviderArticle } from "@/lib/provider-article";

/**
 * Migra la publicación de un juego LEGACY (artículo firmado por la tienda) a la
 * cuenta del PROVEEDOR: recibe el 30023 re-firmado por él, lo difunde, cambia el
 * régimen a "provider" y actualiza la identidad Nostr del caché.
 *
 * ⚠️ La coordenada del juego CAMBIA (cambia el pubkey del firmante): la actividad
 * histórica anclada a la coord vieja (scores 31337, reseñas, presencia) NO migra,
 * y los juegos integrados que cachearon `gameCoord` (GET /api/v1/session) deben
 * re-leerla. El botón del panel lo advierte antes de firmar.
 *
 * Best-effort adicional: retracta el artículo viejo con un kind:5 firmado por la
 * TIENDA (ese sí lo puede firmar el server), para que no queden dos 30023 del
 * mismo juego bajo coords distintas.
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
  const game = owned.game;
  if (game.status !== "published") {
    return NextResponse.json(
      { error: "Solo se puede migrar un juego publicado" },
      { status: 400 },
    );
  }
  if (game.articleSigner !== "store") {
    return NextResponse.json(
      { error: "Este juego ya lo firma el proveedor" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const check = await checkProviderArticle({
    game,
    provider: owned.provider,
    sessionPubkey: session.pubkey,
    signedEvent: body.signedEvent,
    req,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  // Difundimos ANTES de tocar la DB: si ningún relay acepta, el juego sigue
  // siendo legacy y funcional (no dejamos una coord nueva que no existe en
  // ningún relay).
  const accepted = await broadcastSignedEvent(check.event);
  if (accepted === 0) {
    return NextResponse.json(
      { error: "Ningún relay aceptó el artículo firmado; probá de nuevo" },
      { status: 502 },
    );
  }

  const oldEventId = game.nostrEventId;
  const oldCoord = game.nostrCoord;

  const ev = check.event;
  const publishedAtRaw = Number(ev.tags.find((t) => t[0] === "published_at")?.[1]);
  const publishedAt = Number.isFinite(publishedAtRaw) && publishedAtRaw > 0
    ? publishedAtRaw
    : ev.created_at;

  const updated = await prisma.game.update({
    where: { id },
    data: {
      articleSigner: "provider",
      nostrEventId: ev.id,
      nostrPubkey: ev.pubkey,
      nostrCoord: gameArticleCoord(ev.pubkey, game.slug),
      nostrPublishedAt: new Date(publishedAt * 1000),
      nostrUpdatedAt: new Date(ev.created_at * 1000),
      articleDirty: false,
    },
  });

  // Retractación del artículo viejo de la tienda (best-effort, no bloquea).
  if (oldEventId) {
    try {
      void publishStoreArticleDeletion(oldEventId, oldCoord);
    } catch (err) {
      console.error("[migrate-article] no se pudo retractar el artículo viejo:", err);
    }
  }

  revalidateCatalog();
  return NextResponse.json({ game: updated });
}
