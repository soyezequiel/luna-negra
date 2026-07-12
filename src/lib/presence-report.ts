import { SimplePool, nip19, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { NGP_KIND, parsePresenceEvent } from "nostr-game-protocol/ngp-core";
import {
  getLiveNow,
  getPeakToday,
  presenceMemorySnapshot,
  LIVE_PRESENCE_SYNC_INTERVAL_MS,
  LIVE_PRESENCE_WINDOW_SECONDS,
} from "./live-presence";

/**
 * Reporte de diagnóstico de presencia "jugando ahora" (NIP-38 / kind:30315) para
 * el admin. Junta TODO lo necesario para entender por qué un juego cerrado sigue
 * detectándose como abierto (o "vuelve" sin reabrirse):
 *
 *  - los eventos NIP-38 crudos que sirve CADA relay por separado (para ver
 *    divergencia entre relays, eventos sin expiración NIP-40, tombstones que no
 *    llegaron, y el estado del slot compartido `d:general`);
 *  - la resolución que hace el sync del badge en vivo (ventana de 180s) y la que
 *    hace el riel de amigos (fallback de 1h), con su veredicto por jugador;
 *  - el estado en memoria del server (a quién cuenta AHORA) y las filas de DB
 *    (GamePresence legada, muestras PlayerCountSample, pings de integración);
 *  - banderas de diagnóstico automáticas que señalan las causas conocidas.
 *
 * Es de solo lectura: consulta relays y DB, no publica ni modifica nada. Usa un
 * `SimplePool` propio y efímero para no interferir con el pool del sync.
 *
 * NOTA sobre constantes espejadas: las del lado cliente (playing-presence.ts,
 * nostr-social.ts) se replican acá con su valor y origen porque esos módulos
 * arrastran `window.nostr` (signer) y no se pueden importar en el server. Si
 * cambian allá, actualizar acá. Ver también STATUS_FALLBACK_TTL_SECONDS que SÍ
 * está exportada desde nostr-social pero se mantiene espejada para no importar
 * el módulo cliente.
 */

// Espejo de las constantes que gobiernan el ciclo de vida (ver NOTA arriba).
const STORE = {
  POLL_INTERVAL_MS: 8_000, // playing-presence.ts: cada cuánto la tienda renueva
  STATUS_TTL_S: 120, // playing-presence.ts: expiración NIP-40 del estado de la tienda
  STARTUP_GRACE_MS: 30_000, // playing-presence.ts: gracia si el juego nunca reporta
} as const;
const SOCIAL = {
  STATUS_FALLBACK_TTL_SECONDS: 3600, // nostr-social.ts: vigencia de un estado SIN NIP-40 (1h)
  STALE_GAME_PRESENCE_SECONDS: 600, // nostr-social.ts: umbral para "colgada" sin NIP-40
  CLEAR_STATUS_TTL_SECONDS: 120, // nostr-social.ts: TTL del tombstone del clear
  PRESENCE_D_TAG: "general", // slot compartido kind:30315 d="general"
  LUNA_LABEL: "luna-negra", // etiqueta `l` de la presencia optimista de la tienda
} as const;

const MAX_WAIT_MS = 6000;

function tag(ev: Event, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}

type EventKind =
  | "tombstone" // content vacío = clear
  | "store-optimistic" // firmado por la tienda (etiqueta luna-negra)
  | "game-signed" // auto-firmado por el juego (ancla a coord, sin etiqueta luna)
  | "manual-or-other"; // estado de texto manual u otra app en el mismo slot

export function classify(ev: Event, coord: string): EventKind {
  if (ev.content.length === 0) return "tombstone";
  const isLuna = tag(ev, "l") === SOCIAL.LUNA_LABEL;
  if (isLuna) return "store-optimistic";
  if (tag(ev, "a") === coord) return "game-signed";
  return "manual-or-other";
}

export type ReportEvent = {
  id: string;
  pubkey: string;
  npub: string;
  createdAt: number;
  createdAtIso: string;
  ageSeconds: number;
  content: string;
  contentLength: number;
  hasExpiration: boolean;
  expirationEpoch: number | null;
  expirationIso: string | null;
  /** Segundos hasta que venza (negativo = ya venció). null si no trae NIP-40. */
  secondsUntilExpiry: number | null;
  dTag: string | null;
  aTag: string | null;
  matchesGameCoord: boolean;
  hasLunaLabel: boolean;
  hasLinkTag: boolean;
  classification: EventKind;
  /** Veredicto del parser del protocolo (lo que usa el sync del badge en vivo). */
  parserActive: boolean;
  /** ¿Cae dentro de la ventana de lectura del sync (created_at ≥ now - 180s)? */
  withinLiveWindow: boolean;
  servedByRelays: string[];
};

export function toReportEvent(
  ev: Event,
  coord: string,
  nowSec: number,
  windowStart: number,
  servedByRelays: string[],
): ReportEvent {
  const parsed = parsePresenceEvent(ev, nowSec);
  const expRaw = tag(ev, "expiration");
  const exp = expRaw !== undefined ? Number(expRaw) : NaN;
  const hasExpiration = Number.isFinite(exp);
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    npub: safeNpub(ev.pubkey),
    createdAt: ev.created_at,
    createdAtIso: new Date(ev.created_at * 1000).toISOString(),
    ageSeconds: nowSec - ev.created_at,
    content: ev.content.slice(0, 200),
    contentLength: ev.content.length,
    hasExpiration,
    expirationEpoch: hasExpiration ? exp : null,
    expirationIso: hasExpiration ? new Date(exp * 1000).toISOString() : null,
    secondsUntilExpiry: hasExpiration ? exp - nowSec : null,
    dTag: tag(ev, "d") ?? null,
    aTag: tag(ev, "a") ?? null,
    matchesGameCoord: tag(ev, "a") === coord,
    hasLunaLabel: tag(ev, "l") === SOCIAL.LUNA_LABEL,
    hasLinkTag: ev.tags.some((t) => t[0] === "r"),
    classification: classify(ev, coord),
    parserActive: Boolean(parsed?.active),
    withinLiveWindow: ev.created_at >= windowStart,
    servedByRelays,
  };
}

function safeNpub(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}

/** Consulta un filtro contra CADA relay por separado, para ver la divergencia. */
async function queryPerRelay(
  pool: SimplePool,
  filter: Parameters<SimplePool["querySync"]>[1],
): Promise<{ byRelay: Map<string, Event[]>; errors: Record<string, string> }> {
  const byRelay = new Map<string, Event[]>();
  const errors: Record<string, string> = {};
  await Promise.all(
    RELAYS.map(async (relay) => {
      try {
        const evs = await pool.querySync([relay], filter, { maxWait: MAX_WAIT_MS });
        byRelay.set(relay, evs);
      } catch (e) {
        byRelay.set(relay, []);
        errors[relay] = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  return { byRelay, errors };
}

/**
 * Deduplica eventos por id acumulando en qué relays apareció cada uno, y arma
 * un resumen por relay (cuántos sirvió, created_at más nuevo, error si hubo).
 */
function foldRelayResults(
  byRelay: Map<string, Event[]>,
  errors: Record<string, string>,
): {
  events: Map<string, { ev: Event; relays: string[] }>;
  perRelay: Array<{
    relay: string;
    ok: boolean;
    error: string | null;
    events: number;
    latestCreatedAt: number | null;
  }>;
} {
  const events = new Map<string, { ev: Event; relays: string[] }>();
  const perRelay: ReturnType<typeof foldRelayResults>["perRelay"] = [];
  for (const relay of RELAYS) {
    const evs = byRelay.get(relay) ?? [];
    let latest: number | null = null;
    for (const ev of evs) {
      latest = latest === null ? ev.created_at : Math.max(latest, ev.created_at);
      const entry = events.get(ev.id);
      if (entry) entry.relays.push(relay);
      else events.set(ev.id, { ev, relays: [relay] });
    }
    perRelay.push({
      relay,
      ok: !errors[relay],
      error: errors[relay] ?? null,
      events: evs.length,
      latestCreatedAt: latest,
    });
  }
  return { events, perRelay };
}

/** El evento más nuevo por pubkey (misma regla que el sync y el riel). */
function latestByPubkey(events: ReportEvent[]): Map<string, ReportEvent> {
  const m = new Map<string, ReportEvent>();
  for (const ev of events) {
    const prev = m.get(ev.pubkey);
    if (!prev || ev.createdAt > prev.createdAt) m.set(ev.pubkey, ev);
  }
  return m;
}

export type PresenceReport = Awaited<ReturnType<typeof buildPresenceReport>>;

const HEX64 = /^[0-9a-f]{64}$/i;

export async function buildPresenceReport(gameId: string, opts?: { pubkey?: string }) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      providerId: true,
      nostrCoord: true,
    },
  });
  if (!game) return { error: "GAME_NOT_FOUND" as const };
  if (!game.nostrCoord) {
    return { error: "GAME_HAS_NO_COORD" as const, game };
  }

  const coord = game.nostrCoord;
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - LIVE_PRESENCE_WINDOW_SECONDS;
  const pool = new SimplePool();

  try {
    // ── 1. Eventos anclados a la coordenada del juego (lo que ve el badge "en vivo").
    //    Sin `since`: traemos lo que cada relay tenga, para ver también rezagados
    //    fuera de la ventana de 180s (ayuda a explicar por qué "vuelve").
    const coordRes = await queryPerRelay(pool, { kinds: [NGP_KIND.presence], "#a": [coord] });
    const coordFold = foldRelayResults(coordRes.byRelay, coordRes.errors);
    const coordEvents = [...coordFold.events.values()]
      .map(({ ev, relays }) => toReportEvent(ev, coord, nowSec, windowStart, relays))
      .sort((a, b) => b.createdAt - a.createdAt);

    // ── 2. Slot compartido `d:general` de cada jugador que alguna vez ancló acá.
    //    Es donde chocan la presencia de la tienda, la del juego y el tombstone;
    //    revela si el clear llegó y si el estado vigente sigue "activo".
    //    Incluimos SIEMPRE el autor de la coord (el dev del juego, `30023:<pk>:<slug>`)
    //    y un pubkey opcional del pedido: así el tombstone es visible aun cuando ya
    //    no queda presencia activa anclada (justo tras cerrar el juego).
    const coordAuthor = coord.split(":")[1];
    const extraPubkeys = [coordAuthor, opts?.pubkey].filter(
      (pk): pk is string => typeof pk === "string" && HEX64.test(pk),
    );
    const pubkeys = [...new Set([...coordEvents.map((e) => e.pubkey), ...extraPubkeys])];
    let slotEvents: ReportEvent[] = [];
    let slotPerRelay: ReturnType<typeof foldRelayResults>["perRelay"] = [];
    const slotErrors: Record<string, string> = {};
    if (pubkeys.length > 0) {
      const slotRes = await queryPerRelay(pool, {
        kinds: [NGP_KIND.presence],
        "#d": [SOCIAL.PRESENCE_D_TAG],
        authors: pubkeys,
      });
      Object.assign(slotErrors, slotRes.errors);
      const slotFold = foldRelayResults(slotRes.byRelay, slotRes.errors);
      slotPerRelay = slotFold.perRelay;
      slotEvents = [...slotFold.events.values()]
        .map(({ ev, relays }) => toReportEvent(ev, coord, nowSec, windowStart, relays))
        .sort((a, b) => b.createdAt - a.createdAt);
    }

    // ── 3. Resolución del badge "en vivo" (emula syncLivePresence): dentro de la
    //    ventana de 180s, el último por pubkey; cuenta si parser.active && ancla.
    const liveWindowEvents = coordEvents.filter((e) => e.withinLiveWindow);
    const liveLatest = latestByPubkey(liveWindowEvents);
    const liveResolution = [...liveLatest.values()].map((e) => ({
      npub: e.npub,
      counted: e.parserActive && e.matchesGameCoord,
      classification: e.classification,
      ageSeconds: e.ageSeconds,
      secondsUntilExpiry: e.secondsUntilExpiry,
      hasExpiration: e.hasExpiration,
      eventId: e.id,
    }));
    const liveNowFromRelays = liveResolution.filter((r) => r.counted).length;

    // ── 4. Resolución del riel de amigos (emula selectFreshStatuses sobre d:general):
    //    fresco = content no vacío y no vencido; sin NIP-40 vive created_at+1h.
    const slotLatest = latestByPubkey(slotEvents.length > 0 ? slotEvents : []);
    const friendsResolution = [...slotLatest.values()].map((e) => {
      const expiresAtEffective =
        e.expirationEpoch ?? e.createdAt + SOCIAL.STATUS_FALLBACK_TTL_SECONDS;
      const fresh = e.contentLength > 0 && expiresAtEffective > nowSec;
      return {
        npub: e.npub,
        showsAsPlaying: fresh && (e.matchesGameCoord || e.hasLunaLabel),
        classification: e.classification,
        ageSeconds: e.ageSeconds,
        hasExpiration: e.hasExpiration,
        secondsUntilExpiry: e.secondsUntilExpiry,
        effectiveExpiryInSeconds: expiresAtEffective - nowSec,
        eventId: e.id,
      };
    });

    // ── 5. Estado en memoria del server + resultado real de los getters públicos.
    const memory = presenceMemorySnapshot(gameId);
    const [liveNow, peakToday] = await Promise.all([
      getLiveNow(gameId).catch(() => -1),
      getPeakToday(gameId).catch(() => -1),
    ]);

    // ── 6. Filas de DB relevantes.
    const [gamePresenceRows, samples, pings] = await Promise.all([
      prisma.gamePresence.findMany({
        where: { providerId: game.providerId },
        select: {
          npub: true,
          gameId: true,
          status: true,
          expiresAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      prisma.playerCountSample.findMany({
        where: { gameId },
        select: { count: true, npubs: true, source: true, sampledAt: true },
        orderBy: { sampledAt: "desc" },
        take: 40,
      }),
      prisma.integrationPing.findMany({
        where: { gameId, feature: { in: ["ngp:presencia", "ngp:oraculo", "presence"] } },
        select: { feature: true, count: true, firstSeenAt: true, lastSeenAt: true },
      }),
    ]);

    // ── 7. Banderas de diagnóstico automáticas.
    //   Último refresco de presencia detectado: el ping "ngp:presencia" solo se
    //   registra cuando un jugador RENUEVA su estado (created_at avanza entre
    //   ciclos). Una muestra de conteo posterior a esto SIN un refresco cercano es
    //   presencia contada sin renovación = evento colgado (la huella del falso
    //   positivo, visible aun cuando el evento ya se cayó de los relays).
    const lastRefreshMs = pings
      .filter((p) => p.feature === "ngp:presencia")
      .reduce<number | null>(
        (max, p) => Math.max(max ?? 0, p.lastSeenAt.getTime()) || null,
        null,
      );
    const diagnostics = buildDiagnostics({
      coordEvents,
      slotLatest,
      liveResolution,
      coordPerRelay: coordFold.perRelay,
      nowSec,
      liveSamples: samples
        .filter((s) => s.source === "live-2.0" && s.count > 0)
        .map((s) => ({ sampledAtMs: s.sampledAt.getTime(), count: s.count })),
      lastPresenceRefreshMs: lastRefreshMs,
    });

    return {
      generatedAt: new Date().toISOString(),
      serverClock: { nowSec, iso: new Date(nowSec * 1000).toISOString() },
      game,
      coord,
      config: {
        relays: RELAYS,
        live: {
          syncIntervalMs: LIVE_PRESENCE_SYNC_INTERVAL_MS,
          readWindowSeconds: LIVE_PRESENCE_WINDOW_SECONDS,
        },
        store: STORE,
        social: SOCIAL,
        note: "Las constantes store/social son espejo de los módulos cliente (ver presence-report.ts).",
      },
      liveBadge: {
        // Lo que muestra el badge "jugando ahora" en la página del juego.
        getLiveNow: liveNow,
        getPeakToday: peakToday,
        computedFromRelaysNow: liveNowFromRelays,
        resolution: liveResolution,
        perRelay: coordFold.perRelay,
        relayErrors: coordRes.errors,
      },
      friendsRail: {
        // Lo que muestra el riel "amigos jugando" (regla de 1h de fallback).
        resolution: friendsResolution,
        perRelay: slotPerRelay,
        relayErrors: slotErrors,
      },
      serverMemory: memory,
      rawEvents: {
        coordAnchored: coordEvents,
        sharedSlotGeneral: slotEvents,
      },
      db: {
        gamePresence: gamePresenceRows.map((r) => ({
          ...r,
          expiresAt: r.expiresAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          expired: r.expiresAt.getTime() <= Date.now(),
        })),
        playerCountSamples: samples.map((s) => ({
          count: s.count,
          npubCount: s.npubs.length,
          source: s.source,
          sampledAt: s.sampledAt.toISOString(),
        })),
        integrationPings: pings.map((p) => ({
          feature: p.feature,
          count: p.count,
          firstSeenAt: p.firstSeenAt.toISOString(),
          lastSeenAt: p.lastSeenAt.toISOString(),
        })),
      },
      diagnostics,
    };
  } finally {
    // Cerramos las conexiones del pool efímero (no interferir con el pool del sync).
    try {
      pool.close(RELAYS);
    } catch {
      /* best-effort */
    }
  }
}

export type Diagnostic = {
  code: string;
  severity: "info" | "warn" | "alert";
  message: string;
  detail?: unknown;
};

// Holgura entre una muestra de conteo y el último refresco antes de sospechar que
// la presencia se contó SIN renovarse: el ping "ngp:presencia" está throttleado a
// 1/min, así que damos 2 min de gracia para no marcar gameplay real como colgado.
const LINGER_SLACK_MS = 120_000;
const LIVE_PRESENCE_WINDOW_SECONDS_MS = LIVE_PRESENCE_WINDOW_SECONDS * 1000;

export function buildDiagnostics(args: {
  coordEvents: ReportEvent[];
  slotLatest: Map<string, ReportEvent>;
  liveResolution: Array<{ npub: string; counted: boolean }>;
  coordPerRelay: Array<{ relay: string; latestCreatedAt: number | null; events: number }>;
  nowSec: number;
  /** Muestras live-2.0 (count>0) recientes, para correlacionar con el refresco. */
  liveSamples?: Array<{ sampledAtMs: number; count: number }>;
  /** Último `ngp:presencia` (refresco real detectado), en ms. null si nunca hubo. */
  lastPresenceRefreshMs?: number | null;
}): Diagnostic[] {
  const { coordEvents, slotLatest, liveResolution, coordPerRelay, nowSec } = args;
  const out: Diagnostic[] = [];

  // (0) Correlación histórica: muestras que contaron presencia DESPUÉS del último
  //     refresco (más allá de la holgura del throttle) = presencia contada sin que
  //     nadie renovara su estado ⇒ evento colgado (falso positivo). Se ve aun
  //     cuando el evento ya se cayó de los relays, así que atrapa el bug post-mortem.
  //     Excluimos las muestras recientes (dentro de la ventana de lectura) cuando
  //     HAY eventos frescos presentes: esas muestras las explican esos eventos, no
  //     un colgado. Un juego que re-firma cada 2-4 min (más lento que el ciclo de
  //     30s) tampoco dispara el refresco pese a ser gameplay real, así que sin este
  //     recorte la bandera marcaría de más.
  const samples = args.liveSamples ?? [];
  const lastRefresh = args.lastPresenceRefreshMs ?? null;
  const nowMs = nowSec * 1000;
  const hasFreshNow =
    coordEvents.some((e) => e.withinLiveWindow && e.parserActive && e.matchesGameCoord);
  const recentCutoffMs = nowMs - LIVE_PRESENCE_WINDOW_SECONDS_MS;
  if (samples.length > 0) {
    const lingering = samples.filter((s) => {
      const afterRefresh = lastRefresh === null || s.sampledAtMs > lastRefresh + LINGER_SLACK_MS;
      const explainedByCurrent = hasFreshNow && s.sampledAtMs >= recentCutoffMs;
      return afterRefresh && !explainedByCurrent;
    });
    if (lingering.length > 0) {
      const newest = Math.max(...lingering.map((s) => s.sampledAtMs));
      out.push({
        code: "COUNTED_WITHOUT_REFRESH",
        severity: "warn",
        message:
          `${lingering.length} muestra(s) de conteo contaron presencia sin un refresco cercano` +
          (lastRefresh === null
            ? " (nunca se registró un refresco `ngp:presencia`): la presencia se contó sin renovarse ⇒ evento colgado."
            : `: el último refresco real fue hace ${Math.round((nowMs - lastRefresh) / 60000)} min, pero se siguió contando después ⇒ evento colgado (huella del falso positivo).`),
        detail: {
          lastPresenceRefreshMs: lastRefresh,
          lingeringSamples: lingering.length,
          newestLingeringSampleAgoSeconds: Math.max(0, Math.round((nowMs - newest) / 1000)),
        },
      });
    }
  }

  // (1) Eventos anclados con contenido y SIN expiración NIP-40 → el parser nunca
  //     los vence: son la causa clásica del "sigue jugando" y del "vuelve".
  const noExpiry = coordEvents.filter(
    (e) => e.contentLength > 0 && !e.hasExpiration && e.classification !== "tombstone",
  );
  if (noExpiry.length > 0) {
    out.push({
      code: "EVENTS_WITHOUT_NIP40",
      severity: "alert",
      message: `${noExpiry.length} evento(s) de presencia con contenido y SIN expiración NIP-40: el parser los considera "activos" para siempre y no vencen solos.`,
      detail: noExpiry.map((e) => ({ npub: e.npub, ageSeconds: e.ageSeconds, id: e.id })),
    });
  }

  // (2) Presencia auto-firmada por el juego, aún "activa" pero con created_at viejo
  //     (el juego dejó de re-firmar hace rato = sesión cerrada, pero sigue contando).
  const staleGameSigned = coordEvents.filter(
    (e) =>
      e.classification === "game-signed" &&
      e.parserActive &&
      e.withinLiveWindow === false &&
      e.ageSeconds > SOCIAL.STALE_GAME_PRESENCE_SECONDS,
  );
  if (staleGameSigned.length > 0) {
    out.push({
      code: "STALE_GAME_SIGNED_ACTIVE",
      severity: "warn",
      message: `${staleGameSigned.length} presencia(s) auto-firmada(s) por el juego siguen "activas" pese a un created_at viejo (posible sesión cerrada que no venció).`,
      detail: staleGameSigned.map((e) => ({
        npub: e.npub,
        ageSeconds: e.ageSeconds,
        secondsUntilExpiry: e.secondsUntilExpiry,
      })),
    });
  }

  // (3) Divergencia entre relays: el created_at más nuevo difiere entre relays →
  //     un relay sirve un evento viejo que otro ya reemplazó ⇒ "va y vuelve".
  const latests = coordPerRelay
    .map((r) => r.latestCreatedAt)
    .filter((v): v is number => v !== null);
  if (latests.length >= 2) {
    const spread = Math.max(...latests) - Math.min(...latests);
    if (spread > STORE.POLL_INTERVAL_MS / 1000) {
      out.push({
        code: "RELAY_DIVERGENCE",
        severity: "warn",
        message: `Los relays no coinciden en el evento más nuevo (diferencia de ${spread}s): un relay puede estar sirviendo un estado viejo que otro ya reemplazó, lo que hace parpadear la detección.`,
        detail: coordPerRelay.map((r) => ({
          relay: r.relay,
          events: r.events,
          latestCreatedAt: r.latestCreatedAt,
          latestAgeSeconds: r.latestCreatedAt !== null ? nowSec - r.latestCreatedAt : null,
        })),
      });
    }
  }

  // (4) Falta el tombstone: el estado vigente del slot d:general de un jugador
  //     sigue "activo" (no es un clear de content vacío) → nunca se limpió.
  const missingTombstone = [...slotLatest.values()].filter(
    (e) => e.classification !== "tombstone" && e.contentLength > 0 && e.parserActive,
  );
  if (missingTombstone.length > 0) {
    out.push({
      code: "MISSING_TOMBSTONE",
      severity: "info",
      message: `${missingTombstone.length} jugador(es) tienen su último estado d:general "activo" (sin un clear de contenido vacío que lo apague).`,
      detail: missingTombstone.map((e) => ({
        npub: e.npub,
        classification: e.classification,
        ageSeconds: e.ageSeconds,
        secondsUntilExpiry: e.secondsUntilExpiry,
      })),
    });
  }

  // (5) Reloj: si algún evento tiene created_at en el futuro respecto al server,
  //     hay clock drift (afecta el cálculo de vencimiento).
  const future = coordEvents.filter((e) => e.ageSeconds < -30);
  if (future.length > 0) {
    out.push({
      code: "CLOCK_DRIFT",
      severity: "warn",
      message: `${future.length} evento(s) con created_at en el futuro respecto al reloj del server (posible desfase de reloj cliente/server).`,
      detail: future.map((e) => ({ npub: e.npub, ageSeconds: e.ageSeconds })),
    });
  }

  if (out.length === 0) {
    out.push({
      code: "NO_ISSUES",
      severity: "info",
      message: "No se detectaron patrones conocidos de falso positivo en esta corrida. Si el síntoma persiste, generá el reporte JUSTO después de cerrar el juego.",
    });
  }

  const countedNpubs = liveResolution.filter((r) => r.counted).map((r) => r.npub);
  out.unshift({
    code: "SUMMARY",
    severity: countedNpubs.length > 0 ? "warn" : "info",
    message: `Ahora mismo el badge contaría ${countedNpubs.length} jugador(es) desde relays.`,
    detail: { countedNpubs },
  });

  return out;
}
