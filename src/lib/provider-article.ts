import { Prisma, type Game, type Provider } from "@prisma/client";
import type { Event } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { gamePageUrl } from "@/lib/site-url";
import { gameArticleCoord } from "@/lib/game-article";
import { validateProviderArticle } from "@/lib/game-article-validate";
import { broadcastSignedEvent } from "@/lib/nostr-server";

/**
 * Lado server del régimen `articleSigner === "provider"`: el artículo NIP-23 del
 * juego lo firma EL PROVEEDOR en su navegador y acá solo validamos, guardamos y
 * difundimos. Helpers compartidos por submit / re-firma / approve / announce /
 * migración para que la validación y el write-through sean idénticos en todos.
 */

export type ProviderArticleCheck =
  | { ok: true; event: Event; ownerPubkey: string }
  | { ok: false; error: string; status: number };

/**
 * Valida un 30023 firmado que llega del navegador del proveedor: la sesión debe
 * ser la CUENTA DUEÑA del proveedor (defensa doble: el evento se compara contra
 * la pubkey canónica de la DB, no contra la de la sesión) y el evento debe
 * corresponder EXACTAMENTE a la ficha actual del juego (ver game-article-validate).
 */
export async function checkProviderArticle(opts: {
  game: Game;
  provider: Provider;
  sessionPubkey: string;
  signedEvent: unknown;
  req: Request;
}): Promise<ProviderArticleCheck> {
  const owner = await prisma.user.findUnique({
    where: { id: opts.provider.ownerId },
    select: { pubkey: true },
  });
  if (!owner?.pubkey) {
    return { ok: false, error: "El proveedor no tiene cuenta Nostr asociada", status: 400 };
  }
  if (owner.pubkey !== opts.sessionPubkey) {
    return {
      ok: false,
      error: "Tu sesión no corresponde a la cuenta dueña del proveedor",
      status: 403,
    };
  }
  const r = validateProviderArticle({
    signedEvent: opts.signedEvent,
    game: opts.game,
    expectedPubkey: owner.pubkey,
    gamePageUrl: gamePageUrl(opts.req, opts.game.slug),
  });
  if (!r.ok) return { ok: false, error: r.error, status: 400 };
  return { ok: true, event: r.event, ownerPubkey: owner.pubkey };
}

/**
 * Difunde a relays el artículo firmado pendiente (`Game.signedArticle`) y, si
 * algún relay lo aceptó, proyecta su identidad al caché (write-through, espejo de
 * syncGameToNostr pero sin firmar nada). Si NINGÚN relay aceptó, deja el juego
 * intacto — con `signedArticle` retenido, así cae en el bucket "Sin anuncio" del
 * admin y se puede reintentar con "re-anunciar" sin pedirle otra firma al
 * proveedor. Devuelve el juego (actualizado si se difundió).
 */
export async function broadcastProviderArticle(game: Game): Promise<Game> {
  const ev = game.signedArticle as Event | null;
  if (!ev) return game;

  const accepted = await broadcastSignedEvent(ev);
  if (accepted === 0) {
    console.error("[nostr] el artículo del proveedor no fue aceptado:", ev.id);
    return game;
  }

  const publishedAtRaw = Number(
    ev.tags.find((t) => t[0] === "published_at")?.[1],
  );
  const publishedAt = Number.isFinite(publishedAtRaw) && publishedAtRaw > 0
    ? publishedAtRaw
    : ev.created_at;

  return prisma.game.update({
    where: { id: game.id },
    data: {
      nostrEventId: ev.id,
      nostrPubkey: ev.pubkey,
      nostrCoord: gameArticleCoord(ev.pubkey, game.slug),
      nostrPublishedAt: new Date(publishedAt * 1000),
      nostrUpdatedAt: new Date(ev.created_at * 1000),
      // DbNull (NULL de SQL): "sin firma pendiente". Prisma no acepta null pelado
      // en un campo Json? (ambiguo entre NULL de SQL y null de JSON).
      signedArticle: Prisma.DbNull,
      articleDirty: false,
    },
  });
}
