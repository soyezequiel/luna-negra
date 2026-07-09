import { SimplePool, nip19, verifyEvent, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { submitScore } from "./leaderboard";
import { recordIntegration } from "./integration-telemetry";
import { NGP_KIND, parseScoreEvent } from "nostr-game-protocol/ngp-core";

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

// kind addressable del evento de puntaje (rango 30000-39999). Congelado en el
// núcleo de protocolo compartido con los juegos (nostr-game-protocol/ngp-core).
export const SCORE_KIND = NGP_KIND.score;

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
  // El desarme del evento (kind, coordenada, board, score) es del protocolo y
  // vive en el core; el default de tabla y la proyección son política nuestra.
  const parsed = parseScoreEvent(ev);
  if (!parsed) return;
  if (!verifyEvent(ev)) return; // anti-forja: la firma tiene que cerrar con pubkey

  const gameId = byCoord.get(parsed.gameCoord);
  if (!gameId) return; // no es un juego nuestro (o no publicado)

  // Detección automática de la capacidad "marcador" (NGP): ver un kind:31337 válido
  // firmado por el jugador y anclado a la coordenada del juego ES la evidencia de que
  // integró el marcador Nostr. La persistimos como ping "ngp:marcador" (throttle 1/min
  // por juego) para que el panel marque "Detectado" SIEMPRE, sin depender de que este
  // score en particular mejore el récord. Antes la detección colgaba de
  // `Score.sourceEventId`, que `submitScore` solo setea si `improved` — así un récord
  // fijado antes por REST 1.0 dejaba el marcador Nostr invisible aunque existiera.
  void recordIntegration("ngp:marcador", { gameId });

  const board = parsed.board ?? "clasico";
  const score = parsed.score;

  // El jugador es el firmante del evento: su pubkey → npub estable.
  const npub = nip19.npubEncode(ev.pubkey);

  // submitScore valida nombre de tabla y rango de score; si algo no cuadra
  // devuelve { ok: false } y simplemente no proyectamos (no lanzamos).
  await submitScore(gameId, board, npub, score, {
    eventId: ev.id,
    pubkey: ev.pubkey,
  });
}
