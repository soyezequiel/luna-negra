import type { Game } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishGameAnnouncement } from "@/lib/nostr-server";
import { gamePageUrl } from "@/lib/site-url";

/**
 * Publica el anuncio raíz del juego en Nostr y guarda su id/pubkey en la DB.
 * Idempotente: si el juego ya tiene `nostrEventId`, no hace nada. Best-effort:
 * si no hay clave o ningún relay acepta, el juego queda sin anuncio (los
 * comentarios caen al modo nota suelta) y se puede reintentar con "re-anunciar".
 *
 * Devuelve el juego (actualizado si se publicó).
 */
export async function announceGame(game: Game, req: Request): Promise<Game> {
  if (game.nostrEventId) return game;

  const announced = await publishGameAnnouncement({
    slug: game.slug,
    title: game.title,
    description: game.description,
    coverUrl: game.coverUrl,
    priceSats: game.priceSats,
    gameUrl: gamePageUrl(req, game.slug),
  });
  if (!announced) return game;

  return prisma.game.update({
    where: { id: game.id },
    data: { nostrEventId: announced.id, nostrPubkey: announced.pubkey },
  });
}
