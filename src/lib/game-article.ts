// Artículo NIP-23 (kind:30023) de un juego: la representación CANÓNICA del juego
// publicado en Nostr. La tienda lo firma con su clave al aprobar/editar y la DB
// queda como caché de lectura (write-through). Al ser un evento *direccionable*
// (replaceable con tag `d`), se puede editar sin cambiar su coordenada
// `30023:<pubkey>:<slug>`, de modo que los comentarios/reseñas que cuelgan de él
// (tag `a`) siguen enlazados aunque la ficha cambie.
//
// Este módulo es PURO y server-safe: solo arma/parsea el evento, sin tocar
// relays ni el firmador (eso vive en nostr-server.ts y game-sync.ts).

import { nip19, type Event } from "nostr-tools";
import { gameTag } from "./constants";
import { normalizeCategories } from "./categories";

export const GAME_ARTICLE_KIND = 30023;

/** Coordenada direccionable (tag `a`) del artículo de un juego. */
export function gameArticleCoord(pubkey: string, slug: string): string {
  return `${GAME_ARTICLE_KIND}:${pubkey}:${slug}`;
}

/**
 * Dirección NIP-19 (`naddr1…`) del artículo del juego: la forma portable con la
 * que cualquier cliente Nostr (o un gateway como njump.me) abre el evento
 * addressable, incluyendo pistas de relay para encontrarlo. Es la coordenada
 * `30023:<pubkey>:<slug>` empaquetada. Módulo isomórfico: sirve en server y
 * cliente. Devuelve null si la pubkey no es un hex válido de 32 bytes.
 */
export function gameArticleNaddr(
  pubkey: string,
  slug: string,
  relays: string[] = [],
): string | null {
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
  try {
    return nip19.naddrEncode({
      identifier: slug,
      pubkey,
      kind: GAME_ARTICLE_KIND,
      relays,
    });
  } catch {
    return null;
  }
}

/** Deriva el `naddr1…` desde una coordenada `30023:<pubkey>:<slug>` cacheada. */
export function gameArticleNaddrFromCoord(
  coord: string | null | undefined,
  relays: string[] = [],
): string | null {
  if (!coord) return null;
  const parts = coord.split(":");
  if (parts.length < 3 || parts[0] !== String(GAME_ARTICLE_KIND)) return null;
  const pubkey = parts[1];
  const slug = parts.slice(2).join(":");
  return gameArticleNaddr(pubkey, slug, relays);
}

/** Datos del juego necesarios para construir su artículo. */
export type GameArticleInput = {
  slug: string;
  title: string;
  description: string;
  categories: string[];
  priceSats: number;
  coverUrl?: string | null;
  horizontalCoverUrl?: string | null;
  screenshots?: string | null; // JSON array de URLs (como se guarda en la DB)
  videos?: string | null; // JSON array de URLs de video (trailers)
  gameUrl?: string | null;
  // Oráculo de atestaciones (NGP kind:31338): el artículo lo publica como tag
  // ["oracle", pk] — la DELEGACIÓN contra la que un verificador cruza el firmante
  // de las atestaciones del juego. Declarado con prueba de posesión.
  attestationOraclePubkey?: string | null;
};

/** Proyección del artículo de vuelta a campos del caché `Game`. */
export type ParsedGameArticle = {
  slug: string;
  title: string;
  description: string;
  categories: string[];
  priceSats: number;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
  screenshots: string; // JSON array de URLs
  videos: string; // JSON array de URLs de video
  gameUrl: string | null;
  publishedAt: number | null; // unix (segundos) del `published_at`
};

/** Parsea un array JSON de URLs (capturas o videos) guardado en la DB. */
function parseUrlList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Resumen en texto plano (NIP-23 `summary`) a partir de la descripción HTML. */
function plainSummary(description: string, max = 280): string {
  const text = (description ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Template del evento kind:30023 (sin firmar) para un juego. El `content` es la
 * descripción tal cual (HTML liviano, estilo ficha); los datos estructurados van
 * en tags para round-trip exacto del caché. `published_at` se preserva entre
 * ediciones (lo pasa el caller con la fecha del primer posteo).
 */
export function buildGameArticleTemplate(
  game: GameArticleInput,
  opts: { gamePageUrl: string; publishedAt: number },
): { kind: number; created_at: number; tags: string[][]; content: string } {
  const tags: string[][] = [
    ["d", game.slug],
    ["title", game.title],
    ["published_at", String(opts.publishedAt)],
    // El tag `t` de Luna Negra mantiene la compat con el fetch/sync de
    // comentarios por slug (comment-sync filtra por `#t`).
    ["t", gameTag(game.slug)],
    ["r", opts.gamePageUrl],
    ["price", String(Math.max(0, Math.floor(game.priceSats)))],
  ];

  const summary = plainSummary(game.description);
  if (summary) tags.push(["summary", summary]);
  if (game.coverUrl) tags.push(["image", game.coverUrl]);
  if (game.horizontalCoverUrl)
    tags.push(["horizontal_cover", game.horizontalCoverUrl]);
  if (game.gameUrl) tags.push(["game_url", game.gameUrl]);
  // Delegación del oráculo de atestaciones (NGP §3.4): el verificador de un
  // kind:31338 confía solo si su firmante == esta pubkey declarada.
  if (game.attestationOraclePubkey)
    tags.push(["oracle", game.attestationOraclePubkey]);
  for (const c of normalizeCategories(game.categories)) tags.push(["t", c]);
  for (const url of parseUrlList(game.screenshots))
    tags.push(["screenshot", url]);
  for (const url of parseUrlList(game.videos)) tags.push(["video", url]);

  return {
    kind: GAME_ARTICLE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: game.description ?? "",
  };
}

/**
 * Lee un artículo kind:30023 y devuelve los campos para proyectar al caché.
 * Devuelve null si no es un artículo de juego válido (sin `d`). La descripción
 * vuelve cruda; el caller la re-sanea antes de guardar.
 */
export function parseGameArticle(
  ev: Pick<Event, "kind" | "tags" | "content">,
): ParsedGameArticle | null {
  if (ev.kind !== GAME_ARTICLE_KIND) return null;
  const first = (k: string): string | undefined =>
    ev.tags.find((t) => t[0] === k)?.[1];

  const slug = first("d");
  if (!slug) return null;

  const priceRaw = first("price");
  const priceSats = priceRaw != null ? Math.max(0, Math.floor(Number(priceRaw) || 0)) : 0;
  const publishedRaw = first("published_at");
  const publishedAt = publishedRaw ? Number(publishedRaw) || null : null;

  // Categorías = tags `t` que no son el marcador interno `lunanegra:game:*`.
  const categories = ev.tags
    .filter((t) => t[0] === "t" && t[1] && t[1] !== gameTag(slug))
    .map((t) => t[1]);
  const screenshots = ev.tags
    .filter((t) => t[0] === "screenshot" && t[1])
    .map((t) => t[1]);
  const videos = ev.tags
    .filter((t) => t[0] === "video" && t[1])
    .map((t) => t[1]);

  return {
    slug,
    title: first("title") ?? "",
    description: typeof ev.content === "string" ? ev.content : "",
    categories: normalizeCategories(categories),
    priceSats,
    coverUrl: first("image") ?? null,
    horizontalCoverUrl: first("horizontal_cover") ?? null,
    screenshots: JSON.stringify(screenshots),
    videos: JSON.stringify(videos),
    gameUrl: first("game_url") ?? null,
    publishedAt,
  };
}
