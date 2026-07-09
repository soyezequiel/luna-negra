import { SimplePool, verifyEvent, type Event } from "nostr-tools";
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
 * es su artículo NIP-23 (kind:30023) — firmado por la TIENDA (legacy,
 * articleSigner="store") o por el PROVEEDOR (articleSigner="provider") — y la
 * tabla `Game` es un caché write-through. Acá levantamos de relays los artículos
 * de TODOS los firmantes conocidos (la tienda + las pubkeys de los juegos
 * publicados) y, si traen una versión más nueva que la cacheada, proyectamos sus
 * campos a la DB. Esto hace que el caché sea reconstruible desde Nostr (podés
 * vaciar los campos y se rearman) y captura ediciones hechas fuera del
 * write-through (p.ej. el proveedor editando su artículo desde otro cliente
 * Nostr). Mismo patrón in-process que zap-sync / comment-sync.
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
// barre todos los artículos de los firmantes conocidos.
let lastCheckedAt = 0;

export async function syncGames(): Promise<void> {
  // Autores a levantar: la tienda (legacy) + las pubkeys que firmaron artículos
  // de juegos publicados + los dueños de proveedores con juegos provider-firmados
  // (cubre el bootstrap: identidad cacheada vaciada → el artículo igual se
  // encuentra por su autor legítimo). Sin ninguno, no hay nada que reconciliar.
  const storePubkey = getStorePubkey();
  const published = await prisma.game.findMany({
    where: { status: "published" },
    select: {
      nostrPubkey: true,
      articleSigner: true,
      provider: { select: { owner: { select: { pubkey: true } } } },
    },
  });
  const authors = [
    ...new Set(
      [
        storePubkey,
        ...published.map((g) => g.nostrPubkey),
        ...published
          .filter((g) => g.articleSigner === "provider")
          .map((g) => g.provider.owner.pubkey),
      ].filter((p): p is string => !!p),
    ),
  ];
  if (authors.length === 0) return;

  const since = lastCheckedAt > 0 ? lastCheckedAt - OVERLAP_SECONDS : undefined;
  const startedAt = Math.floor(Date.now() / 1000);

  let events: Event[];
  try {
    events = await pool().querySync(
      RELAYS,
      {
        kinds: [GAME_ARTICLE_KIND],
        authors,
        ...(since ? { since } : {}),
      },
      { maxWait: 5000 },
    );
  } catch {
    return; // relays caídos: reintentamos en el próximo tick (cursor intacto)
  }

  // Replaceable: nos quedamos con el más nuevo por coordenada (pubkey+slug) por
  // si distintos relays sirven versiones distintas. La clave incluye el autor:
  // dos firmantes con el mismo `d` son artículos DISTINTOS (no deben pisarse).
  const latestByCoord = new Map<string, Event>();
  for (const ev of events) {
    const slug = ev.tags.find((t) => t[0] === "d")?.[1];
    if (!slug) continue;
    const coord = gameArticleCoord(ev.pubkey, slug);
    const prev = latestByCoord.get(coord);
    if (!prev || ev.created_at > prev.created_at) latestByCoord.set(coord, ev);
  }

  let changed = false;
  for (const ev of latestByCoord.values()) {
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
async function reconcileArticle(
  ev: Event,
  storePubkey: string | null,
): Promise<boolean> {
  const parsed = parseGameArticle(ev);
  if (!parsed) return false;

  const game = await prisma.game.findUnique({
    where: { slug: parsed.slug },
    select: {
      id: true,
      status: true,
      nostrUpdatedAt: true,
      nostrPubkey: true,
      articleSigner: true,
      provider: { select: { owner: { select: { pubkey: true } } } },
    },
  });
  // Solo reconciliamos juegos publicados (el artículo es su forma publicada). No
  // resucitamos juegos despublicados ni pisamos borradores en edición.
  if (!game || game.status !== "published") return false;

  // El artículo debe estar firmado por el firmante LEGÍTIMO del juego: un
  // tercero que publique un 30023 con el mismo `d` (slug) no puede pisar el
  // caché. (El filtro `authors` ya restringe, pero un relay podría mentir:
  // defensa doble.) Con la identidad cacheada exigimos ESA pubkey; si fue
  // vaciada (el caché es reconstruible desde Nostr), aceptamos el firmante que
  // corresponde al régimen del juego: la tienda ("store") o el dueño del
  // proveedor ("provider").
  const expectedPubkey =
    game.nostrPubkey ??
    (game.articleSigner === "provider"
      ? game.provider.owner.pubkey
      : storePubkey);
  if (!expectedPubkey || ev.pubkey !== expectedPubkey) return false;
  if (!verifyEvent(ev)) return false; // anti-forja: la firma tiene que cerrar

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
      videos: parsed.videos,
      gameUrl: parsed.gameUrl,
      nostrEventId: ev.id,
      nostrPubkey: ev.pubkey,
      nostrCoord: gameArticleCoord(ev.pubkey, parsed.slug),
      nostrPublishedAt: parsed.publishedAt
        ? new Date(parsed.publishedAt * 1000)
        : undefined,
      nostrUpdatedAt: new Date(ev.created_at * 1000),
    },
  });
  return true;
}
