import { SimplePool, nip19, verifyEvent, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { submitScore } from "./leaderboard";

/**
 * Reconciliación de PUNTAJES desde Nostr (Nostr Games Protocol (NGP)). El jugador firma su
 * marcador como evento addressable kind:31337 tageando la coordenada del juego
 * (`a` = 30023:<pubkey>:<slug>); acá los levantamos de relays, verificamos la
 * firma y los proyectamos a la tabla `Score` — el MISMO read-model que alimenta
 * la API REST 1.0 (`submitScore`). Así la UI del marcador no se entera de cuál de
 * los dos caminos fijó el récord, y el ranking es reconstruible desde Nostr.
 *
 * Mismo patrón in-process que zap-sync / game-sync / comment-sync: el scheduler
 * vive en src/instrumentation.ts. Idempotente: keep-best por (juego, tabla,
 * jugador) absorbe duplicados y re-corridas.
 *
 * Ver docs/nostr-games-protocol.md (spec) y docs/nostr-games-protocol-implementacion.md.
 */

// kind addressable del evento de puntaje (rango 30000-39999). Si se congela otro
// número en la spec, cambiarlo acá y en la guía de integración.
export const SCORE_KIND = 31337;

// Cadencia del sync corriendo IN-PROCESS (self-host). 0 = desactivado.
export const SCORE_SYNC_INTERVAL_MS = Number(
  process.env.SCORE_SYNC_INTERVAL_MS ?? 60_000,
); // 60 s

// Solape entre corridas: pedimos desde `lastChecked - OVERLAP` para no perder
// eventos que un relay sirvió tarde. El keep-best absorbe el solape.
const OVERLAP_SECONDS = 120;

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

// Cursor en memoria (una sola instancia en self-host). 0 = primera corrida:
// barre todo el historial (acotado por los `#a` de juegos publicados).
let lastCheckedAt = 0;

export async function syncScores(): Promise<void> {
  // Mapa coordenada → gameId. Solo juegos publicados con su coordenada cacheada
  // (la setea la publicación del artículo 30023). game-sync mantiene esto al día.
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
      { kinds: [SCORE_KIND], "#a": [...byCoord.keys()], ...(since ? { since } : {}) },
      { maxWait: 5000 },
    );
  } catch {
    return; // relays caídos: reintentamos en el próximo tick (cursor intacto)
  }

  for (const ev of events) {
    try {
      await recordScoreEvent(ev, byCoord);
    } catch {
      /* evento inválido o ya registrado: seguimos con el resto */
    }
  }
  lastCheckedAt = startedAt;
}

/**
 * Proyecta un único evento de puntaje a la tabla `Score`. Verifica la firma,
 * resuelve la coordenada a un juego conocido y delega en `submitScore` (keep-best
 * + procedencia). Separado de `syncScores` para poder testearlo sin relays.
 */
export async function recordScoreEvent(
  ev: Event,
  byCoord: Map<string, string>,
): Promise<void> {
  if (ev.kind !== SCORE_KIND) return;
  if (!verifyEvent(ev)) return; // anti-forja: la firma tiene que cerrar con pubkey

  const tag = (k: string) => ev.tags.find((t) => t[0] === k)?.[1];

  const coord = tag("a");
  const gameId = coord ? byCoord.get(coord) : undefined;
  if (!gameId) return; // no es un juego nuestro (o no publicado)

  const board = tag("board") ?? "clasico";
  const score = Number(tag("score"));
  if (!Number.isFinite(score)) return;

  // El jugador es el firmante del evento: su pubkey → npub estable.
  const npub = nip19.npubEncode(ev.pubkey);

  // submitScore valida nombre de tabla y rango de score; si algo no cuadra
  // devuelve { ok: false } y simplemente no proyectamos (no lanzamos).
  await submitScore(gameId, board, npub, score, {
    eventId: ev.id,
    pubkey: ev.pubkey,
  });
}
