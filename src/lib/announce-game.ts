import type { Game } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishGameArticle } from "@/lib/nostr-server";
import { gamePageUrl } from "@/lib/site-url";

/**
 * Publica/actualiza el artículo NIP-23 del juego en Nostr (fuente de verdad) y
 * proyecta su identidad al caché de la DB (write-through). Se llama al aprobar y
 * en cada edición de un juego publicado: como el artículo es direccionable
 * (mismo `d` = slug), re-publicar NO cambia su coordenada, así que comentarios y
 * reseñas siguen enlazados. `published_at` se preserva del primer posteo.
 *
 * Best-effort: si no hay `LUNA_NEGRA_NSEC` o ningún relay acepta, el juego queda
 * publicado en la DB sin artículo (se puede reintentar con "re-anunciar") y se
 * devuelve el juego sin tocar. Devuelve el juego (actualizado si se publicó).
 */
export async function syncGameToNostr(game: Game, req: Request): Promise<Game> {
  const publishedAt = game.nostrPublishedAt
    ? Math.floor(game.nostrPublishedAt.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const published = await publishGameArticle(
    game,
    gamePageUrl(req, game.slug),
    publishedAt,
  );
  if (!published) return game;

  return prisma.game.update({
    where: { id: game.id },
    data: {
      nostrEventId: published.id,
      nostrPubkey: published.pubkey,
      nostrCoord: published.coord,
      nostrPublishedAt: new Date(published.publishedAt * 1000),
      nostrUpdatedAt: new Date(published.createdAt * 1000),
    },
  });
}
