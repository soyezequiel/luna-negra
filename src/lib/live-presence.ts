import { SimplePool, nip19, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { NGP_KIND, parsePresenceEvent } from "nostr-game-protocol/ngp-core";
import { recordIntegration } from "./integration-telemetry";

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

/** Ventana de lectura del sync (segundos), expuesta para el reporte de diagnóstico. */
export const LIVE_PRESENCE_WINDOW_SECONDS = WINDOW_SECONDS;

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

// Marca temporal de la última presencia vista por (juego, pubkey), entre ciclos
// del sync. Sirve para exigir presencia SOSTENIDA antes de dar por integrada la
// capacidad: solo si el MISMO jugador renueva su estado NIP-38 (su `created_at`
// avanza de un ciclo al siguiente) lo contamos como integración. Un evento
// optimista de un solo click "flota" sobre su TTL sin renovarse → nunca avanza.
const presenceSeenAt = new Map<string, Map<string, number>>();

/**
 * ¿Algún jugador RENOVÓ su presencia respecto al ciclo anterior? Es true solo si
 * un mismo pubkey aparece en ambos ciclos con un `created_at` más nuevo — la
 * huella del refresco periódico (gameplay real / presencia nativa NGP). Un evento
 * optimista de un solo click no se renueva: su created_at no cambia → false.
 * `prev`/`current` son mapas pubkey→created_at (el más nuevo por jugador y ciclo).
 */
export function presenceWasRefreshed(
  prev: Map<string, number> | undefined,
  current: Map<string, number>,
): boolean {
  for (const [pubkey, createdAt] of current) {
    const prevAt = prev?.get(pubkey);
    if (prevAt !== undefined && createdAt > prevAt) return true;
  }
  return false;
}

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
      { kinds: [NGP_KIND.presence], "#a": [...byCoord.keys()], since },
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
  const next = new Map<
    string,
    { providerId: string; npubs: Set<string>; createdByPubkey: Map<string, number> }
  >();
  for (const ev of latestByPubkey.values()) {
    // Vigencia y ancla las decide el protocolo (contenido vacío = presencia
    // limpiada; expiración NIP-40 pasada = vencida).
    const parsed = parsePresenceEvent(ev, nowSec);
    if (!parsed || !parsed.active || !parsed.gameCoord) continue;

    const target = byCoord.get(parsed.gameCoord);
    if (!target) continue;

    let grp = next.get(target.gameId);
    if (!grp)
      next.set(
        target.gameId,
        (grp = { providerId: target.providerId, npubs: new Set(), createdByPubkey: new Map() }),
      );
    grp.npubs.add(nip19.npubEncode(ev.pubkey));
    grp.createdByPubkey.set(ev.pubkey, ev.created_at);
  }

  liveByGame.clear();
  for (const [gameId, grp] of next) liveByGame.set(gameId, grp.npubs);

  // Detección automática de la presencia NGP: la evidencia de que un juego integró
  // la presencia es ver su estado NIP-38 SOSTENIDO — o sea, RENOVADO. Solo la damos
  // por integrada cuando el MISMO jugador vuelve a firmar su estado entre dos ciclos
  // del sync (su `created_at` avanza), que es lo que hace el gameplay real o la
  // presencia nativa NGP (refresco cada ~8s). Un evento optimista de un solo click
  // (la tienda al abrir el juego) "flota" sobre su TTL sin renovarse: su created_at
  // nunca avanza, así que NO lo contamos — evita el falso "Detectado" que dejaba
  // pegado un solo click. Se persiste como ping "ngp:presencia" (best-effort; el
  // throttle dedupea a 1/min por juego) para que el panel marque "Detectado" solo,
  // sin que el proveedor lo declare a mano.
  const nextSeen = new Map<string, Map<string, number>>();
  for (const [gameId, grp] of next) {
    const refreshed = presenceWasRefreshed(presenceSeenAt.get(gameId), grp.createdByPubkey);
    nextSeen.set(gameId, grp.createdByPubkey);
    if (refreshed) {
      void recordIntegration("ngp:presencia", { providerId: grp.providerId, gameId });
    }
  }
  // Solo recordamos los juegos con presencia de ESTE ciclo: los que dejaron de
  // tenerla reinician su racha (su próxima aparición vuelve a ser "primera vista").
  presenceSeenAt.clear();
  for (const [gameId, seen] of nextSeen) presenceSeenAt.set(gameId, seen);

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

  await detectVerifiedScore(byCoord);
}

/**
 * Auto-detección del "marcador verificado" (atestación del oráculo, kind:31338).
 * A diferencia de la presencia (efímera, ventana de 180s), la atestación es
 * PERMANENTE (addressable): la buscamos SIN `since` y SOLO para los juegos que
 * todavía no tienen la señal — una vez detectada, el ping "ngp:oraculo" queda fijo
 * y no hace falta re-consultarla. Sin esto, el 31338 solo se detectaba corriendo
 * "Verificar ahora" a mano: no tenía job propio como el marcador 31339 (score-sync).
 */
async function detectVerifiedScore(
  byCoord: Map<string, { gameId: string; providerId: string }>,
): Promise<void> {
  try {
    const gameIds = [...new Set([...byCoord.values()].map((t) => t.gameId))];
    const detected = await prisma.integrationPing.findMany({
      where: { feature: "ngp:oraculo", gameId: { in: gameIds } },
      select: { gameId: true },
    });
    const done = new Set(detected.map((p) => p.gameId));
    const pending = new Map([...byCoord].filter(([, t]) => !done.has(t.gameId)));
    if (pending.size === 0) return;

    const attestations = await pool().querySync(
      RELAYS,
      { kinds: [NGP_KIND.scoreAttestation], "#a": [...pending.keys()] },
      { maxWait: 5000 },
    );
    const recorded = new Set<string>();
    for (const ev of attestations) {
      const coord = ev.tags.find((t) => t[0] === "a")?.[1];
      const target = coord ? pending.get(coord) : undefined;
      if (!target || recorded.has(target.gameId)) continue;
      recorded.add(target.gameId);
      // Ver una atestación del oráculo anclada al juego ES la evidencia de que
      // integró el marcador verificado (mismo criterio que el probador manual).
      void recordIntegration("ngp:oraculo", {
        providerId: target.providerId,
        gameId: target.gameId,
      });
    }
  } catch {
    // best-effort: relays/DB caídos → reintenta el próximo ciclo.
  }
}

/**
 * Jugadores AHORA de un juego, unificando las dos fuentes: presencia 1.0
 * (`GamePresence`; su reporte REST fue retirado con la interfaz 1.0, así que hoy
 * sólo quedan filas legadas) y la NGP en memoria (NIP-38, ver arriba). Un mismo
 * npub no debería aparecer en
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

/**
 * Foto del estado en memoria del sync para un juego, para el reporte de
 * diagnóstico de presencia (admin). `liveNpubs` = a quién cuenta AHORA como
 * "jugando" (lo que devuelve `getLiveNow` por la vía NGP); `seenAtByPubkey` =
 * el `created_at` del último ciclo por jugador (insumo de `presenceWasRefreshed`,
 * o sea la racha de renovación que exige la auto-detección de integración).
 * Solo lee los mapas en memoria; no toca relays ni DB.
 */
export function presenceMemorySnapshot(gameId: string): {
  liveNpubs: string[];
  seenAtByPubkey: Record<string, number>;
} {
  return {
    liveNpubs: [...(liveByGame.get(gameId) ?? [])],
    seenAtByPubkey: Object.fromEntries(presenceSeenAt.get(gameId) ?? new Map()),
  };
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
