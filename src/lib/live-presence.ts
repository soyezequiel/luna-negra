import { SimplePool, nip19, type Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { NGP_KIND, NGP_PRESENCE_D_TAG, parsePresenceEvent } from "nostr-game-protocol/ngp-core";
import { recordIntegration } from "./integration-telemetry";

/**
 * "Jugando ahora" (Nostr Games Protocol (NGP)): para los juegos que NO integran la presencia
 * REST (§3, `GamePresence`), la ÚNICA señal de quién está jugando es el propio
 * estado NIP-38 (`kind:30315`) que la pestaña de la tienda firma y renueva cada
 * ~8s mientras el juego reporta (ver playing-presence.ts), anclado a la
 * coordenada del juego. Acá los contamos por juego combinando dos caminos:
 * una suscripción PERSISTENTE a los relays (cada evento reconcilia al instante
 * → detección en segundos) y un tick periódico de backfill/poda/muestreo —
 * mismo patrón in-process que score-sync/comment-sync — y los unificamos con
 * la presencia 1.0 en `getLiveNow`.
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

// Vida máxima que le damos a una presencia en memoria, como tope de seguridad por
// si un evento declara una expiración NIP-40 absurdamente lejana (el máximo del
// protocolo NGP es 240s; damos margen por clock drift). Sin esto, un evento con
// `expiration` bugueada podría dejar a alguien "jugando" para siempre.
const MAX_PRESENCE_LIFETIME_S = 300;
// Cuánto recordamos el `created_at` del último clear/tombstone de un jugador para
// no "resucitarlo" si un relay lento vuelve a servir su evento viejo pre-cierre.
const TOMBSTONE_TTL_S = 300;

/** Presencia vigente de un jugador en un juego, con su vencimiento efectivo. */
export type LiveEntry = {
  npub: string;
  providerId: string;
  createdAt: number;
  /** Instante (epoch s) hasta el que se cuenta: NIP-40 del evento, o fallback. */
  expiresAt: number;
};

/**
 * Estado en memoria del sync. Va en `globalThis` a propósito: Turbopack bundlea
 * este módulo en varios chunks (el scheduler que lo puebla y las rutas que leen
 * `getLiveNow` pueden caer en chunks distintos), así que un `const` a nivel de
 * módulo daría instancias separadas y el badge leería siempre 0. Mismo patrón que
 * `prisma.ts`. Ver memoria "Turbopack duplica estado".
 *
 *  - `byGame`: gameId → (pubkey hex → presencia vigente). Es PERSISTENTE entre
 *    ciclos: una query flaky que pierde un evento NO borra al jugador; solo sale
 *    cuando vence (`expiresAt`) o llega un clear (contenido vacío / sin coord).
 *  - `tombstones`: pubkey → created_at del último clear, anti-resurrección.
 *  - `seenAt`: gameId → (pubkey → created_at fresco del ciclo), para la racha de
 *    refresco que exige la auto-detección de integración (`presenceWasRefreshed`).
 */
export type LiveState = {
  byGame: Map<string, Map<string, LiveEntry>>;
  tombstones: Map<string, number>;
  seenAt: Map<string, Map<string, number>>;
};

const _g = globalThis as unknown as { __lunaLivePresence?: LiveState };
function state(): LiveState {
  if (!_g.__lunaLivePresence)
    _g.__lunaLivePresence = { byGame: new Map(), tombstones: new Map(), seenAt: new Map() };
  return _g.__lunaLivePresence;
}

/** Observación de un jugador en un ciclo: el último evento NIP-38 ya resuelto. */
export type PresenceObservation = {
  pubkey: string;
  npub: string;
  /** gameId del catálogo si el estado ancla a un juego vigente; null si no. */
  gameId: string | null;
  providerId: string | null;
  active: boolean;
  createdAt: number;
  /** Vencimiento efectivo (ya calculado) si `active`. */
  expiresAt: number;
};

/** Destino en el catálogo de una coordenada de juego publicada. */
type CoordTarget = { gameId: string; providerId: string };

/**
 * Traduce un evento NIP-38 crudo a la observación que consume la reconciliación
 * (vigencia/ancla según el protocolo + vencimiento efectivo acotado). Compartido
 * entre el tick periódico y la suscripción en vivo para que ambos caminos
 * apliquen EXACTAMENTE las mismas reglas.
 */
function toObservation(
  ev: Event,
  byCoord: Map<string, CoordTarget>,
  nowSec: number,
): PresenceObservation | null {
  // Vigencia y ancla las decide el protocolo (contenido vacío = presencia
  // limpiada; expiración NIP-40 pasada = vencida).
  const parsed = parsePresenceEvent(ev, nowSec);
  if (!parsed) return null;
  const target = parsed.gameCoord ? byCoord.get(parsed.gameCoord) : undefined;
  const active = parsed.active && !!target;
  // Vencimiento efectivo: NIP-40 del evento, o fallback a la ventana de lectura,
  // acotado por el tope de seguridad (evita expiraciones absurdas).
  const expiresAt = active
    ? Math.min(
        parsed.expiresAt ?? ev.created_at + WINDOW_SECONDS,
        ev.created_at + MAX_PRESENCE_LIFETIME_S,
      )
    : 0;
  return {
    pubkey: ev.pubkey,
    npub: nip19.npubEncode(ev.pubkey),
    gameId: active ? target!.gameId : null,
    providerId: active ? target!.providerId : null,
    active,
    createdAt: ev.created_at,
    expiresAt,
  };
}

/**
 * Suscripciones PERSISTENTES a los relays: cada evento que llega se reconcilia
 * al instante contra el estado en memoria, así el badge "jugando ahora" no
 * espera al próximo tick (antes la detección tardaba hasta
 * LIVE_PRESENCE_SYNC_INTERVAL_MS). Son DOS suscripciones complementarias:
 *
 *  - por COORDENADA (`#a` = juegos del catálogo): altas y renovaciones. No ve
 *    los CLEARS, porque el template de clear del protocolo no lleva tag `a`
 *    (contenido vacío + expiración inmediata) — y como 30315 es reemplazable,
 *    el clear PISA a la presencia activa en el relay: por la vía `#a` la tienda
 *    solo "deja de ver" al jugador y lo retenía hasta vencer su NIP-40 (~4 min).
 *  - por AUTOR (los pubkeys que están "jugando ahora", slot `#d:general`):
 *    captura ese clear (y cualquier cambio de estado a otro juego/status) al
 *    instante, para bajar el badge en segundos al salir del juego.
 *
 * El tick queda como backfill/poda/muestreo. Mismo patrón de resuscripción ante
 * cierre que nge-service. Va en `globalThis` por la duplicación de chunks de
 * Turbopack (ver LiveState).
 */
type ManagedSub = {
  closer: SubCloser | null;
  /** Clave del filtro suscripto (coords o autores), para re-suscribir si cambia. */
  key: string;
  /** true cuando el cierre es nuestro (cambio de filtro), para no re-suscribir. */
  closedByUs: boolean;
};

type LiveSubState = {
  coordSub: ManagedSub | null;
  authorSub: ManagedSub | null;
  /** Destinos vigentes por coordenada; los handlers siempre leen la versión fresca. */
  targets: Map<string, CoordTarget>;
};

const _gSub = globalThis as unknown as { __lunaLivePresenceSub?: LiveSubState };
function subState(): LiveSubState {
  if (!_gSub.__lunaLivePresenceSub)
    _gSub.__lunaLivePresenceSub = { coordSub: null, authorSub: null, targets: new Map() };
  return _gSub.__lunaLivePresenceSub;
}

/** Reconciliación inmediata de un evento NIP-38 llegado por suscripción. */
function handleLiveEvent(ev: Event): void {
  // Solo el slot de juego (`d:general`): un status de otro slot (p. ej. music)
  // no toca la presencia. Los filtros ya piden `#d`, pero no confiamos en que
  // todos los relays lo apliquen.
  if (ev.tags.find((t) => t[0] === "d")?.[1] !== NGP_PRESENCE_D_TAG) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const obs = toObservation(ev, subState().targets, nowSec);
  if (!obs) return;
  reconcileLivePresence(state(), [obs], nowSec);
  // El set de jugadores vivos pudo cambiar (alta o clear) → ajustar el watch.
  ensureClearsWatch();
}

/**
 * Abre (o re-abre si cambió el filtro) una de las dos suscripciones. `filter`
 * es un builder para que el `since` se recalcule en cada re-apertura.
 */
function openManagedSub(
  slot: "coordSub" | "authorSub",
  key: string,
  filter: () => Parameters<SimplePool["subscribeMany"]>[1],
): void {
  const ss = subState();
  const existing = ss[slot];
  if (existing?.key === key) return;
  if (existing) {
    existing.closedByUs = true;
    existing.closer?.close();
  }
  const sub: ManagedSub = { closer: null, key, closedByUs: false };
  ss[slot] = sub;
  const open = () => {
    sub.closer = pool().subscribeMany(RELAYS, filter(), {
      onevent: handleLiveEvent,
      onclose: () => {
        // Relay caído o socket muerto: re-suscribir con backoff, salvo que el
        // cierre haya sido nuestro o ya haya una suscripción más nueva.
        if (sub.closedByUs || subState()[slot] !== sub) return;
        setTimeout(open, 10_000).unref?.();
      },
    });
  };
  open();
}

function closeManagedSub(slot: "coordSub" | "authorSub"): void {
  const ss = subState();
  const existing = ss[slot];
  if (!existing) return;
  existing.closedByUs = true;
  existing.closer?.close();
  ss[slot] = null;
}

/** Suscripción por coordenada (altas/renovaciones de presencia del catálogo). */
function ensureLiveSubscription(byCoord: Map<string, CoordTarget>): void {
  const ss = subState();
  // Refrescar los destinos siempre (un juego puede cambiar de proveedor sin
  // cambiar de coordenada); re-suscribir solo si cambió el set de coords.
  ss.targets = byCoord;
  if (byCoord.size === 0) {
    // Catálogo sin coordenadas: no hay nada que escuchar; cerrar las subs viejas
    // para no seguir reconciliando presencia de juegos que ya no están.
    closeManagedSub("coordSub");
    closeManagedSub("authorSub");
    return;
  }
  const coords = [...byCoord.keys()].sort();
  openManagedSub("coordSub", coords.join("\n"), () => ({
    kinds: [NGP_KIND.presence],
    "#a": coords,
    // La ventana `since` cubre el hueco entre caída y resuscripción; los eventos
    // repetidos son inocuos (la reconciliación descarta lo viejo/duplicado).
    since: Math.floor(Date.now() / 1000) - WINDOW_SECONDS,
  }));
}

/**
 * Watch de CLEARS: sigue el slot `d:general` de los jugadores que están
 * "jugando ahora". Sin `since` a propósito: 30315 es reemplazable, el relay
 * manda el estado VIGENTE al suscribir — si el clear se publicó mientras esta
 * sub estaba caída (o entre resuscripciones), igual llega al reconectar.
 * Se llama después de cada reconciliación (tick y eventos en vivo).
 */
function ensureClearsWatch(): void {
  const authors = new Set<string>();
  for (const m of state().byGame.values()) for (const pk of m.keys()) authors.add(pk);
  if (authors.size === 0) {
    closeManagedSub("authorSub");
    return;
  }
  const sorted = [...authors].sort();
  openManagedSub("authorSub", sorted.join("\n"), () => ({
    kinds: [NGP_KIND.presence],
    authors: sorted,
    "#d": [NGP_PRESENCE_D_TAG],
  }));
}

function findEntryCreatedAt(
  byGame: Map<string, Map<string, LiveEntry>>,
  pubkey: string,
): number | undefined {
  for (const m of byGame.values()) {
    const e = m.get(pubkey);
    if (e) return e.createdAt;
  }
  return undefined;
}

function removeFromAllGames(byGame: Map<string, Map<string, LiveEntry>>, pubkey: string): void {
  for (const m of byGame.values()) m.delete(pubkey);
}

/**
 * Aplica las observaciones de un ciclo al estado persistente (función PURA sobre
 * `st`, para poder testearla). Reglas:
 *   - `d:general` es un slot ÚNICO por jugador: el último evento manda; al procesar
 *     a un jugador se lo saca de todos los juegos y se lo re-ubica (o se lo baja).
 *   - anti-resurrección: se ignora un evento cuyo `created_at` no sea MÁS NUEVO que
 *     el último clear recordado (relay lento sirviendo el estado viejo pre-cierre).
 *   - staleness: se ignora un evento más viejo que el que ya tenemos vigente.
 *   - un evento activo anclado a un juego → alta/actualización con su vencimiento.
 *   - un evento no-activo (contenido vacío / vencido / sin coord del catálogo) →
 *     clear: se baja al jugador y se recuerda el tombstone.
 *   - al final se podan las entradas vencidas y los tombstones viejos.
 * Los jugadores que NO aparecen en `observations` (la query no los trajo) se dejan
 * intactos: es lo que evita el parpadeo por queries flaky.
 */
export function reconcileLivePresence(
  st: LiveState,
  observations: PresenceObservation[],
  nowSec: number,
): void {
  for (const o of observations) {
    const clearedAt = st.tombstones.get(o.pubkey);
    if (clearedAt !== undefined && o.createdAt <= clearedAt) continue;
    const existingCreatedAt = findEntryCreatedAt(st.byGame, o.pubkey);
    if (existingCreatedAt !== undefined && o.createdAt < existingCreatedAt) continue;

    removeFromAllGames(st.byGame, o.pubkey);
    if (o.active && o.gameId && o.providerId) {
      let m = st.byGame.get(o.gameId);
      if (!m) st.byGame.set(o.gameId, (m = new Map()));
      m.set(o.pubkey, {
        npub: o.npub,
        providerId: o.providerId,
        createdAt: o.createdAt,
        expiresAt: o.expiresAt,
      });
      st.tombstones.delete(o.pubkey);
    } else {
      st.tombstones.set(o.pubkey, o.createdAt);
    }
  }

  for (const [gameId, m] of st.byGame) {
    for (const [pk, e] of m) if (e.expiresAt <= nowSec) m.delete(pk);
    if (m.size === 0) st.byGame.delete(gameId);
  }
  for (const [pk, t] of st.tombstones) if (t + TOMBSTONE_TTL_S <= nowSec) st.tombstones.delete(pk);
}

/** Npubs vigentes (no vencidos) de un juego, desde el estado persistente. */
function liveNpubsOf(gameId: string, nowSec: number): string[] {
  const m = state().byGame.get(gameId);
  if (!m) return [];
  const out: string[] = [];
  for (const e of m.values()) if (e.expiresAt > nowSec) out.push(e.npub);
  return out;
}

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
  const byCoord = new Map<string, CoordTarget>();
  for (const g of games) {
    if (g.nostrCoord) byCoord.set(g.nostrCoord, { gameId: g.id, providerId: g.providerId });
  }
  // Detección en vivo: los eventos nuevos entran por acá al instante; lo que
  // sigue del tick es backfill (por si la sub perdió algo), poda y muestreo.
  ensureLiveSubscription(byCoord);
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
  const providerByGame = new Map(games.map((g) => [g.id, g.providerId]));

  // Observaciones de ESTE ciclo (último evento por jugador ya deduplicado) y, en
  // paralelo, los `created_at` frescos por juego para la racha de refresco.
  const observations: PresenceObservation[] = [];
  const freshByGame = new Map<string, Map<string, number>>();
  for (const ev of latestByPubkey.values()) {
    const obs = toObservation(ev, byCoord, nowSec);
    if (!obs) continue;
    observations.push(obs);
    if (obs.active && obs.gameId) {
      let m = freshByGame.get(obs.gameId);
      if (!m) freshByGame.set(obs.gameId, (m = new Map()));
      m.set(obs.pubkey, obs.createdAt);
    }
  }

  // Reconciliación PERSISTENTE: no colapsa el conteo a 0 cuando una query pierde
  // un evento (parpadeo por relays flaky); solo baja a un jugador cuando vence su
  // presencia o llega un clear. Ver `reconcileLivePresence`.
  const st = state();
  reconcileLivePresence(st, observations, nowSec);
  // El set de jugadores vivos pudo cambiar → ajustar el watch de clears.
  ensureClearsWatch();

  // Detección automática de la presencia NGP: la evidencia de que un juego integró
  // la presencia es ver su estado NIP-38 SOSTENIDO — o sea, RENOVADO. Solo la damos
  // por integrada cuando el MISMO jugador vuelve a firmar su estado entre dos ciclos
  // del sync (su `created_at` avanza), que es lo que hace el gameplay real o la
  // presencia nativa NGP. Un evento optimista de un solo click "flota" sobre su TTL
  // sin renovarse: su created_at nunca avanza, así que NO lo contamos — evita el
  // falso "Detectado". Se persiste como ping "ngp:presencia" (best-effort; el
  // throttle dedupea a 1/min por juego). Se calcula sobre los eventos FRESCOS de
  // este ciclo (no el estado persistente), para conservar la semántica de renovación.
  const nextSeen = new Map<string, Map<string, number>>();
  for (const [gameId, fresh] of freshByGame) {
    const refreshed = presenceWasRefreshed(st.seenAt.get(gameId), fresh);
    nextSeen.set(gameId, fresh);
    if (refreshed) {
      const providerId = providerByGame.get(gameId);
      if (providerId) void recordIntegration("ngp:presencia", { providerId, gameId });
    }
  }
  st.seenAt.clear();
  for (const [gameId, seen] of nextSeen) st.seenAt.set(gameId, seen);

  // Histórico para el pico del día: una fila por juego, desde el estado RECONCILIADO
  // (así la curva tampoco parpadea). Mismo patrón que presence-sampler.ts.
  const data = [...st.byGame.entries()]
    .map(([gameId, m]) => {
      const npubs = [...m.values()].filter((e) => e.expiresAt > nowSec).map((e) => e.npub);
      return { gameId, npubs, providerId: providerByGame.get(gameId) };
    })
    .filter((r) => r.npubs.length > 0 && r.providerId)
    .map((r) => ({
      providerId: r.providerId!,
      gameId: r.gameId,
      count: r.npubs.length,
      npubs: r.npubs.slice(0, 200),
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
  for (const npub of liveNpubsOf(gameId, Math.floor(Date.now() / 1000))) npubs.add(npub);
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
    liveNpubs: liveNpubsOf(gameId, Math.floor(Date.now() / 1000)),
    seenAtByPubkey: Object.fromEntries(state().seenAt.get(gameId) ?? new Map()),
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
