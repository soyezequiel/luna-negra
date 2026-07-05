import { SimplePool, nip19, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";

/**
 * "Jugando ahora" (Nostr Games Protocol (NGP)): para los juegos que NO integran la presencia
 * REST (§3, `GamePresence`), la ÚNICA señal de quién está jugando es el propio
 * estado NIP-38 (`kind:30315`) que la pestaña de la tienda firma y renueva cada
 * ~8s mientras el juego reporta (ver playing-presence.ts), anclado a la
 * coordenada del juego. Acá contamos esos eventos frescos por juego — mismo
 * patrón in-process que score-sync/comment-sync — y los unificamos con la
 * presencia 1.0 en `getLiveNow`.
 *
 * El scheduler vive en src/instrumentation.ts.
 */

export const LIVE_PRESENCE_SYNC_INTERVAL_MS = Number(
  process.env.LIVE_PRESENCE_SYNC_INTERVAL_MS ?? 30_000,
); // 30 s

// Ventana de lectura: NIP-38 se renueva cada ~8s con TTL de 120s (STATUS_TTL_S
// en playing-presence.ts); pedir los últimos 3 minutos alcanza para ver a
// cualquiera que siga activo sin traer historial innecesario.
const WINDOW_SECONDS = 180;

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

// Conteo instantáneo derivado de NIP-38, en memoria (una sola instancia en
// self-host): gameId → npubs con estado fresco y no vencido. No hace falta
// persistir el instante; el histórico para el pico ya sale de
// `PlayerCountSample` (acá solo agregamos una fuente más, "live-2.0").
const liveByGame = new Map<string, Set<string>>();

export async function syncLivePresence(): Promise<void> {
  const games = await prisma.game.findMany({
    where: { status: "published", nostrCoord: { not: null } },
    select: { id: true, providerId: true, nostrCoord: true },
  });
  const byCoord = new Map<string, { gameId: string; providerId: string }>();
  for (const g of games) {
    if (g.nostrCoord) byCoord.set(g.nostrCoord, { gameId: g.id, providerId: g.providerId });
  }
  if (byCoord.size === 0) return;

  const since = Math.floor(Date.now() / 1000) - WINDOW_SECONDS;

  let events: Event[];
  try {
    events = await pool().querySync(
      RELAYS,
      { kinds: [30315], "#a": [...byCoord.keys()], since },
      { maxWait: 5000 },
    );
  } catch {
    return; // relays caídos: dejamos el caché en memoria como estaba
  }

  // Último evento por pubkey: si tiene más de un estado en la ventana, manda
  // el más nuevo (es la verdad vigente de en qué juego está, o si dejó de jugar).
  const latestByPubkey = new Map<string, Event>();
  for (const ev of events) {
    const prev = latestByPubkey.get(ev.pubkey);
    if (!prev || ev.created_at > prev.created_at) latestByPubkey.set(ev.pubkey, ev);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const next = new Map<string, { providerId: string; npubs: Set<string> }>();
  for (const ev of latestByPubkey.values()) {
    if (!ev.content) continue; // clearPlayingStatus publica contenido vacío
    const exp = ev.tags.find((t) => t[0] === "expiration")?.[1];
    if (exp && Number(exp) < nowSec) continue; // vencido (NIP-40)

    const coord = ev.tags.find((t) => t[0] === "a")?.[1];
    const target = coord ? byCoord.get(coord) : undefined;
    if (!target) continue;

    let grp = next.get(target.gameId);
    if (!grp) next.set(target.gameId, (grp = { providerId: target.providerId, npubs: new Set() }));
    grp.npubs.add(nip19.npubEncode(ev.pubkey));
  }

  liveByGame.clear();
  for (const [gameId, grp] of next) liveByGame.set(gameId, grp.npubs);

  // Histórico para el pico del día: una fila por juego con jugadores, mismo
  // patrón que presence-sampler.ts (source distinta: "live-2.0").
  const data = [...next.entries()]
    .filter(([, grp]) => grp.npubs.size > 0)
    .map(([gameId, grp]) => ({
      providerId: grp.providerId,
      gameId,
      count: grp.npubs.size,
      npubs: [...grp.npubs].slice(0, 200),
      source: "live-2.0",
      sampledAt: new Date(),
    }));
  if (data.length > 0) {
    await prisma.playerCountSample.createMany({ data });
  }
}

/**
 * Jugadores AHORA de un juego, unificando las dos fuentes: presencia 1.0
 * (`GamePresence`, la reporta el game server por `POST /api/v1/presence`) y la
 * NGP en memoria (NIP-38, ver arriba). Un mismo npub no debería aparecer en
 * ambas para el mismo juego (son integraciones distintas), pero por las dudas
 * se deduplica.
 */
export async function getLiveNow(gameId: string): Promise<number> {
  const restRows = await prisma.gamePresence.findMany({
    where: { gameId, expiresAt: { gt: new Date() } },
    select: { npub: true },
  });
  const npubs = new Set(restRows.map((r) => r.npub));
  for (const npub of liveByGame.get(gameId) ?? []) npubs.add(npub);
  return npubs.size;
}

/** Pico de jugadores concurrentes del juego en las últimas 24 h (todas las fuentes). */
export async function getPeakToday(gameId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const agg = await prisma.playerCountSample.aggregate({
    where: { gameId, sampledAt: { gte: since } },
    _max: { count: true },
  });
  return agg._max.count ?? 0;
}
