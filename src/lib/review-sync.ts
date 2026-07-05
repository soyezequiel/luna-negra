import { SimplePool, verifyEvent, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";

/**
 * Reconciliación de RESEÑAS desde Nostr (Nostr Games Protocol (NGP)). `publishGameReview`
 * (nostr-social.ts) firma la reseña como respuesta NIP-10 al artículo del juego
 * (tag `a` = coordenada, sin tag `t` — así se distingue de un comentario, que sí
 * lo lleva). Acá levantamos esas notas de relays y las proyectamos a la tabla
 * `Review` — el MISMO read-model que alimenta el POST REST 1.0 (`/api/games/
 * [id]/reviews`) — para que el promedio ("Muy positivas · 4,6 ★") sea
 * reconstruible desde Nostr y no dependa solo de quien pasó por el POST.
 *
 * Mismo patrón in-process que zap/comment/game/score-sync: el scheduler vive en
 * src/instrumentation.ts. Idempotente: upsert por (userId, gameId) — el mismo
 * unique que ya usa la ruta REST — absorbe duplicados y re-corridas.
 */

export const REVIEW_SYNC_INTERVAL_MS = Number(
  process.env.REVIEW_SYNC_INTERVAL_MS ?? 90_000,
); // 90 s

// Solape entre corridas: pedimos desde `lastChecked - OVERLAP` para no perder
// eventos que un relay sirvió tarde. El upsert absorbe el solape.
const OVERLAP_SECONDS = 120;

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

// Cursor en memoria (una sola instancia en self-host). 0 = primera corrida.
let lastCheckedAt = 0;

// Encabezado que arma `publishGameReview`: "★★★★☆ (4/5) · Reseña de «Título»
// en Luna Negra". Anclado al inicio del contenido para no confundirlo con un
// número mencionado en el cuerpo de la reseña.
const RATING_RE = /^[★☆]+\s*\((\d)\/5\)\s*·\s*Reseña de/;

export async function syncGameReviews(): Promise<void> {
  const games = await prisma.game.findMany({
    where: { status: "published", nostrCoord: { not: null } },
    select: { id: true, nostrCoord: true },
  });
  const byCoord = new Map<string, string>();
  for (const g of games) {
    if (g.nostrCoord) byCoord.set(g.nostrCoord, g.id);
  }
  if (byCoord.size === 0) return;

  const since = lastCheckedAt > 0 ? lastCheckedAt - OVERLAP_SECONDS : undefined;
  const startedAt = Math.floor(Date.now() / 1000);

  let events: Event[];
  try {
    events = await pool().querySync(
      RELAYS,
      { kinds: [1], "#a": [...byCoord.keys()], ...(since ? { since } : {}) },
      { maxWait: 5000 },
    );
  } catch {
    return; // relays caídos: reintentamos en el próximo tick (cursor intacto)
  }

  for (const ev of events) {
    try {
      await recordReviewEvent(ev, byCoord);
    } catch {
      /* evento inválido, sin cuenta local o ya registrado: seguimos con el resto */
    }
  }
  lastCheckedAt = startedAt;
}

/**
 * Proyecta un único evento de reseña a la tabla `Review`. Descarta lo que no
 * matchee el formato exacto de `publishGameReview` (comentarios comunes,
 * respuestas de otros clientes Nostr) y lo que no tenga cuenta local asociada
 * (la reseña necesita un `userId`, igual que el POST REST 1.0). Separado de
 * `syncGameReviews` para poder testearlo sin relays.
 */
export async function recordReviewEvent(
  ev: Event,
  byCoord: Map<string, string>,
): Promise<void> {
  if (ev.kind !== 1) return;
  if (ev.tags.some((t) => t[0] === "t")) return; // comentario (lleva `t`), no reseña
  const match = RATING_RE.exec(ev.content);
  if (!match) return; // no tiene el formato de encabezado de publishGameReview
  if (!verifyEvent(ev)) return; // anti-forja: la firma tiene que cerrar con pubkey

  const coord = ev.tags.find((t) => t[0] === "a")?.[1];
  const gameId = coord ? byCoord.get(coord) : undefined;
  if (!gameId) return; // no es un juego nuestro (o no publicado)

  const rating = Number(match[1]);
  if (!(rating >= 1 && rating <= 5)) return;

  const user = await prisma.user.findUnique({
    where: { pubkey: ev.pubkey },
    select: { id: true },
  });
  if (!user) return; // reseña de alguien sin cuenta local: no hay a quién asociarla

  // Cuerpo sin el encabezado (lo que el usuario escribió, si algo).
  const body = ev.content
    .slice(match[0].length)
    .replace(/^\n+/, "")
    .trim()
    .slice(0, 2000);

  await prisma.review.upsert({
    where: { userId_gameId: { userId: user.id, gameId } },
    create: { userId: user.id, gameId, rating, body, sourceEventId: ev.id },
    update: { rating, body, sourceEventId: ev.id },
  });
}
