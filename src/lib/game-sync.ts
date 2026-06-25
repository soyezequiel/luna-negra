import { SimplePool, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { getStorePubkey } from "./nostr-server";
import {
  GAME_ARTICLE_KIND,
  gameArticleCoord,
  parseGameArticle,
} from "./game-article";
import { sanitizeDescriptionHtml } from "./sanitize-description";
import { revalidateCatalog } from "./store-catalog";

/**
 * Reconciliación de JUEGOS desde Nostr. La fuente de verdad del juego publicado
 * es su artículo NIP-23 (kind:30023) firmado por la tienda; la tabla `Game` es un
 * caché write-through. Acá levantamos de relays los artículos de la tienda (por
 * `authors`) y, si traen una versión más nueva que la cacheada, proyectamos sus
 * campos a la DB. Esto hace que el caché sea reconstruible desde Nostr (podés
 * vaciar los campos y se rearman) y captura ediciones hechas fuera del
 * write-through. Mismo patrón in-process que zap-sync / comment-sync.
 *
 * El scheduler vive en src/instrumentation.ts. Idempotente: comparar por
 * `created_at` evita revertir el caché con una copia vieja de un relay lento.
 */

export const GAME_SYNC_INTERVAL_MS = Number(
  process.env.GAME_SYNC_INTERVAL_MS ?? 120_000,
); // 2 min

// Solape entre corridas: pedimos desde `lastChecked - OVERLAP` para no perder
// artículos que un relay sirvió tarde. La comparación por created_at absorbe el solape.
const OVERLAP_SECONDS = 300;

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

// Cursor en memoria (una sola instancia en self-host). 0 = primera corrida:
// barre todos los artículos de la tienda.
let lastCheckedAt = 0;

export async function syncGames(): Promise<void> {
  const storePubkey = getStorePubkey();
  if (!storePubkey) return; // sin LUNA_NEGRA_NSEC no hay artículos que reconciliar

  const since = lastCheckedAt > 0 ? lastCheckedAt - OVERLAP_SECONDS : undefined;
  const startedAt = Math.floor(Date.now() / 1000);

  let events: Event[];
  try {
    events = await pool().querySync(
      RELAYS,
      {
        kinds: [GAME_ARTICLE_KIND],
        authors: [storePubkey],
        ...(since ? { since } : {}),
      },
      { maxWait: 5000 },
    );
  } catch {
    return; // relays caídos: reintentamos en el próximo tick (cursor intacto)
  }

  // Replaceable: nos quedamos con el más nuevo por slug (`d`) por si distintos
  // relays sirven versiones distintas.
  const latestBySlug = new Map<string, Event>();
  for (const ev of events) {
    const slug = ev.tags.find((t) => t[0] === "d")?.[1];
    if (!slug) continue;
    const prev = latestBySlug.get(slug);
    if (!prev || ev.created_at > prev.created_at) latestBySlug.set(slug, ev);
  }

  let changed = false;
  for (const ev of latestBySlug.values()) {
    try {
      if (await reconcileArticle(ev, storePubkey)) changed = true;
    } catch {
      /* artículo inválido o juego ausente: seguimos con el resto */
    }
  }
  lastCheckedAt = startedAt;

  if (changed) {
    // Refrescar el catálogo cacheado. Fuera de un request puede no haber store
    // async; si no, el caché igual caduca solo a los REVALIDATE_SECONDS.
    try {
      revalidateCatalog();
    } catch {
      /* sin contexto de request: lo absorbe el TTL del Data Cache */
    }
  }
}

/** Proyecta un artículo al caché si es más nuevo que lo guardado. Devuelve si cambió. */
async function reconcileArticle(ev: Event, storePubkey: string): Promise<boolean> {
  const parsed = parseGameArticle(ev);
  if (!parsed) return false;

  const game = await prisma.game.findUnique({
    where: { slug: parsed.slug },
    select: { id: true, status: true, nostrUpdatedAt: true },
  });
  // Solo reconciliamos juegos publicados (el artículo es su forma publicada). No
  // resucitamos juegos despublicados ni pisamos borradores en edición.
  if (!game || game.status !== "published") return false;

  const storedAt = game.nostrUpdatedAt
    ? Math.floor(game.nostrUpdatedAt.getTime() / 1000)
    : 0;
  if (ev.created_at <= storedAt) return false; // ya tenemos esta versión (o más nueva)

  await prisma.game.update({
    where: { id: game.id },
    data: {
      title: parsed.title || undefined,
      description: sanitizeDescriptionHtml(parsed.description),
      categories: parsed.categories,
      priceSats: parsed.priceSats,
      coverUrl: parsed.coverUrl,
      horizontalCoverUrl: parsed.horizontalCoverUrl,
      screenshots: parsed.screenshots,
      gameUrl: parsed.gameUrl,
      nostrEventId: ev.id,
      nostrPubkey: storePubkey,
      nostrCoord: gameArticleCoord(storePubkey, parsed.slug),
      nostrPublishedAt: parsed.publishedAt
        ? new Date(parsed.publishedAt * 1000)
        : undefined,
      nostrUpdatedAt: new Date(ev.created_at * 1000),
    },
  });
  return true;
}
