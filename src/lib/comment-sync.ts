import { SimplePool, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS, gameTag } from "./constants";

/**
 * Reconciliación de COMENTARIOS (kind:1). La fuente de verdad es Nostr: los
 * comentarios los firma el usuario como respuesta al anuncio del juego, con el
 * tag `t = lunanegra:game:<slug>` (lo agrega `publishGameNote`). Acá los
 * levantamos de relays y los cacheamos en `GameComment` para que el centro de
 * notificaciones acceda rápido sin depender de los relays en cada carga (mismo
 * patrón que zap-sync con los recibos 9735).
 *
 * Filtramos por el tag `t` de Luna Negra a propósito: así capturamos comentarios
 * (que lo llevan) y NO las reseñas (que se publican como kind:1 sin ese tag, y ya
 * tienen su propia notificación desde la tabla `Review`). El anuncio raíz también
 * lleva el `t`, así que se excluye por id.
 *
 * El scheduler vive en src/instrumentation.ts. Idempotente: `upsert` por
 * `eventId`, re-correr no duplica.
 */

export const COMMENT_SYNC_INTERVAL_MS = Number(
  process.env.COMMENT_SYNC_INTERVAL_MS ?? 60_000,
); // 60 s

// Solape entre corridas: pedimos desde `lastChecked - OVERLAP` para no perder
// notas que un relay sirvió tarde. El dedup por eventId absorbe el solape.
const OVERLAP_SECONDS = 120;

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

// Cursor en memoria (una sola instancia en self-host). 0 = primera corrida:
// barre todo el historial (acotado: hay pocos comentarios al principio).
let lastCheckedAt = 0;

export async function syncGameComments(): Promise<void> {
  // Juegos comentables: publicados y con anuncio (el `t` se ancla al slug).
  const games = await prisma.game.findMany({
    where: { status: "published", nostrEventId: { not: null } },
    select: { id: true, slug: true, nostrEventId: true },
  });
  if (games.length === 0) return;

  // tag `t` → gameId, y set de ids de anuncios (para excluirlos del listado).
  const byTag = new Map<string, string>();
  const rootIds = new Set<string>();
  for (const g of games) {
    byTag.set(gameTag(g.slug), g.id);
    if (g.nostrEventId) rootIds.add(g.nostrEventId);
  }

  const since = lastCheckedAt > 0 ? lastCheckedAt - OVERLAP_SECONDS : undefined;
  const startedAt = Math.floor(Date.now() / 1000);

  let notes: Event[];
  try {
    notes = await pool().querySync(
      RELAYS,
      { kinds: [1], "#t": [...byTag.keys()], ...(since ? { since } : {}) },
      { maxWait: 5000 },
    );
  } catch {
    return; // relays caídos: reintentamos en el próximo tick (cursor intacto)
  }

  for (const note of notes) {
    try {
      await recordComment(note, byTag, rootIds);
    } catch {
      /* nota inválida o ya registrada: seguimos con el resto */
    }
  }
  lastCheckedAt = startedAt;
}

async function recordComment(
  note: Event,
  byTag: Map<string, string>,
  rootIds: Set<string>,
): Promise<void> {
  if (note.kind !== 1) return;
  if (rootIds.has(note.id)) return; // el anuncio no es un comentario

  // ¿A qué juego pertenece? Por su tag `t` conocido.
  let gameId: string | undefined;
  for (const t of note.tags) {
    if (t[0] === "t" && t[1] && byTag.has(t[1])) {
      gameId = byTag.get(t[1]);
      break;
    }
  }
  if (!gameId) return;

  const content =
    typeof note.content === "string" ? note.content.slice(0, 2000) : "";
  if (!content.trim()) return;

  const createdAt = new Date(
    (note.created_at || Math.floor(Date.now() / 1000)) * 1000,
  );

  await prisma.gameComment.upsert({
    where: { eventId: note.id },
    create: {
      eventId: note.id,
      gameId,
      authorPubkey: note.pubkey,
      content,
      createdAt,
    },
    update: {}, // idempotente: si ya existe, no lo tocamos
  });
}
