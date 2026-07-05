import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  INTEGRATION_FEATURES,
  type IntegrationFeature,
} from "@/lib/integration-features";

// Registro best-effort de uso de las interfaces de Luna Negra (§1–§8). Cada
// endpoint del contrato público llama a recordIntegration() cuando lo ejercen de
// verdad; el panel "Integración" lo lee para mostrar qué tiene cableado cada
// juego y cuándo se usó por última vez. No guarda payloads: solo contador y
// timestamps. Nunca debe romper el flujo principal (se traga los errores).

// gameId→providerId es inmutable: cacheamos en memoria para no consultar la DB
// en cada heartbeat de un endpoint atribuido por gameId (presencia, salas…).
const providerOfGameCache = new Map<string, string>();

async function providerOfGame(gameId: string): Promise<string | null> {
  const cached = providerOfGameCache.get(gameId);
  if (cached) return cached;
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { providerId: true },
  });
  if (game) providerOfGameCache.set(gameId, game.providerId);
  return game?.providerId ?? null;
}

type Target = { providerId?: string; gameId?: string };

// Throttle en memoria: los heartbeats (presencia, salas) laten cada pocos
// segundos; sin esto haríamos un upsert por latido. Escribimos como mucho una vez
// por minuto y por (proveedor, juego, feature). El instance serverless es
// efímero, así que en el peor caso escribimos una vez por instancia: aceptable.
// Consecuencia: `count` cuenta ventanas con actividad, no llamadas exactas (sirve
// igual para el panel, que mira sobre todo "última vez visto").
const THROTTLE_MS = 60_000;
const lastWriteAt = new Map<string, number>();

/**
 * Registra (fire-and-forget) que `feature` fue usada. Pasá `gameId` cuando la
 * llamada lo trae (SSO, compra, salas, marcadores, apuestas) o `providerId`
 * cuando es a nivel proveedor (presencia, social, webhooks). Si solo hay
 * `gameId`, el `providerId` se resuelve desde el juego.
 *
 * Devuelve la promesa para poder envolverla en `after()` en route handlers; en
 * contextos sin request (p. ej. el sender de webhooks) llamala con `void`.
 */
export async function recordIntegration(
  feature: IntegrationFeature,
  target: Target,
): Promise<void> {
  try {
    let providerId = target.providerId;
    const gameId = target.gameId ?? "";
    if (!providerId && target.gameId) {
      providerId = (await providerOfGame(target.gameId)) ?? undefined;
    }
    if (!providerId) return;

    const throttleKey = `${providerId}:${gameId}:${feature}`;
    const nowMs = Date.now();
    const prev = lastWriteAt.get(throttleKey);
    if (prev && nowMs - prev < THROTTLE_MS) return;
    lastWriteAt.set(throttleKey, nowMs);

    const now = new Date();
    await prisma.integrationPing.upsert({
      where: {
        providerId_gameId_feature: { providerId, gameId, feature },
      },
      create: {
        providerId,
        gameId,
        feature,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { count: { increment: 1 }, lastSeenAt: now },
    });
  } catch {
    /* telemetría best-effort: nunca rompe el endpoint que la llamó */
  }
}

/**
 * Versión "fire-and-schedule" para route handlers: agenda el registro con
 * `after()` (next/server) para que el runtime serverless mantenga viva la
 * invocación hasta que la escritura termine. Un `void recordIntegration(...)`
 * suelto NO es fiable en serverless: cuando el handler devuelve la Response, la
 * función se puede congelar/matar antes de que la promesa flotante complete su
 * INSERT — por eso la tabla quedaba vacía aunque el juego sí llamara a los
 * endpoints. `after()` usa waitUntil por debajo y evita esa pérdida.
 *
 * Fuera de un request scope (tests, cron del sender de webhooks) `after()` tira,
 * así que caemos a `void`: ahí no hay Response que cierre la función, el proceso
 * sigue vivo y la promesa flotante completa igual. Best-effort en ambos casos.
 */
export function trackIntegration(
  feature: IntegrationFeature,
  target: Target,
): void {
  try {
    after(() => recordIntegration(feature, target));
  } catch {
    void recordIntegration(feature, target);
  }
}

export type PingInfo = {
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

/**
 * Lee todos los pings de un proveedor y los indexa por `gameId` (""=proveedor) y
 * `feature`, para que las rutas de lectura construyan la matriz sin recorrer la
 * lista N veces.
 */
export async function readProviderPings(
  providerId: string,
): Promise<Map<string, Map<string, PingInfo>>> {
  const pings = await prisma.integrationPing.findMany({ where: { providerId } });
  const byGame = new Map<string, Map<string, PingInfo>>();
  for (const p of pings) {
    let m = byGame.get(p.gameId);
    if (!m) {
      m = new Map();
      byGame.set(p.gameId, m);
    }
    m.set(p.feature, {
      count: p.count,
      firstSeenAt: p.firstSeenAt.toISOString(),
      lastSeenAt: p.lastSeenAt.toISOString(),
    });
  }
  return byGame;
}

// ── Evidencia derivada de los datos de dominio ──────────────────────────────
//
// La telemetría (IntegrationPing) solo registra tráfico DESDE que se instrumentó.
// Un juego que ya estaba integrado antes (o cuyas escrituras se perdían por el
// bug del `void`) aparecía como "No integrado" aunque claramente lo usa. Para
// reflejar la realidad, derivamos evidencia de las tablas de dominio que solo
// existen si el juego ejerció la interfaz: compras, marcadores, salas, apuestas,
// presencia e invitaciones. Se fusiona con la telemetría (lo más reciente gana).
//
// §1 SSO no deja rastro persistente (el canje de token es efímero), así que lo
// inferimos: si el juego tiene marcadores/salas/apuestas, obtuvo la identidad del
// jugador, y eso solo se consigue por el flujo de sesión/entitlement (§1).

function isoMax(a: string, b: string): string {
  return a > b ? a : b;
}
function isoMin(a: string, b: string): string {
  return a < b ? a : b;
}

function mergePing(a: PingInfo | null, b: PingInfo | null): PingInfo | null {
  if (!a) return b;
  if (!b) return a;
  return {
    count: a.count + b.count,
    firstSeenAt: isoMin(a.firstSeenAt, b.firstSeenAt),
    lastSeenAt: isoMax(a.lastSeenAt, b.lastSeenAt),
  };
}

function addEvidence(
  byGame: Map<string, Map<string, PingInfo>>,
  gameId: string,
  feature: IntegrationFeature,
  info: PingInfo,
): void {
  let m = byGame.get(gameId);
  if (!m) {
    m = new Map();
    byGame.set(gameId, m);
  }
  m.set(feature, mergePing(m.get(feature) ?? null, info) as PingInfo);
}

const iso = (d: Date) => d.toISOString();

async function deriveDomainEvidence(
  providerId: string,
  gameIds: string[],
): Promise<Map<string, Map<string, PingInfo>>> {
  const byGame = new Map<string, Map<string, PingInfo>>();
  const inGames = { gameId: { in: gameIds } };

  const [purchases, rooms, bets, leaderboards, presence, invites] =
    await Promise.all([
      gameIds.length
        ? prisma.purchase.groupBy({
            by: ["gameId"],
            where: { ...inGames, status: "paid" },
            _count: { _all: true },
            _min: { createdAt: true },
            _max: { createdAt: true },
          })
        : [],
      gameIds.length
        ? prisma.room.groupBy({
            by: ["gameId"],
            where: inGames,
            _count: { _all: true },
            _min: { createdAt: true },
            _max: { createdAt: true },
          })
        : [],
      gameIds.length
        ? prisma.bet.groupBy({
            by: ["gameId"],
            where: inGames,
            _count: { _all: true },
            _min: { createdAt: true },
            _max: { createdAt: true },
          })
        : [],
      gameIds.length
        ? prisma.leaderboard.findMany({
            where: inGames,
            select: {
              gameId: true,
              createdAt: true,
              scores: { select: { createdAt: true, updatedAt: true } },
            },
          })
        : [],
      // Presencia e invitaciones son a nivel proveedor (gameId="") y efímeras:
      // su ausencia NO prueba "no integrado", pero su presencia sí prueba uso.
      prisma.gamePresence.aggregate({
        where: { providerId },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      prisma.gameInvite.aggregate({
        where: { providerId },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);

  for (const p of purchases) {
    if (!p._max.createdAt || !p._min.createdAt) continue;
    addEvidence(byGame, p.gameId, "purchase", {
      count: p._count._all,
      firstSeenAt: iso(p._min.createdAt),
      lastSeenAt: iso(p._max.createdAt),
    });
  }
  for (const r of rooms) {
    if (!r._max.createdAt || !r._min.createdAt) continue;
    addEvidence(byGame, r.gameId, "rooms", {
      count: r._count._all,
      firstSeenAt: iso(r._min.createdAt),
      lastSeenAt: iso(r._max.createdAt),
    });
  }
  for (const b of bets) {
    if (!b._max.createdAt || !b._min.createdAt) continue;
    addEvidence(byGame, b.gameId, "bets", {
      count: b._count._all,
      firstSeenAt: iso(b._min.createdAt),
      lastSeenAt: iso(b._max.createdAt),
    });
  }
  for (const lb of leaderboards) {
    // El marcador existe = el juego golpeó el endpoint §6 al menos una vez.
    let info: PingInfo = {
      count: 1,
      firstSeenAt: iso(lb.createdAt),
      lastSeenAt: iso(lb.createdAt),
    };
    for (const s of lb.scores) {
      info = mergePing(info, {
        count: 1,
        firstSeenAt: iso(s.createdAt),
        lastSeenAt: iso(s.updatedAt),
      }) as PingInfo;
    }
    addEvidence(byGame, lb.gameId, "leaderboards", info);
  }
  if (presence._count._all > 0 && presence._max.updatedAt) {
    addEvidence(byGame, "", "presence", {
      count: presence._count._all,
      firstSeenAt: iso(presence._max.updatedAt),
      lastSeenAt: iso(presence._max.updatedAt),
    });
  }
  if (invites._count._all > 0 && invites._max.createdAt) {
    addEvidence(byGame, "", "social", {
      count: invites._count._all,
      firstSeenAt: iso(invites._max.createdAt),
      lastSeenAt: iso(invites._max.createdAt),
    });
  }

  // §1 SSO inferido: si el juego registró actividad con identidad de jugador
  // (marcadores/salas/apuestas), pasó por el canje de sesión/entitlement.
  for (const [gameId, m] of byGame) {
    if (gameId === "") continue;
    let sso: PingInfo | null = null;
    for (const f of ["leaderboards", "rooms", "bets"] as const) {
      sso = mergePing(sso, m.get(f) ?? null);
    }
    if (sso) m.set("sso", mergePing(m.get("sso") ?? null, sso) as PingInfo);
  }

  return byGame;
}

/** Une dos índices (telemetría + dominio) en uno, fusionando por feature. */
function mergeByGame(
  a: Map<string, Map<string, PingInfo>>,
  b: Map<string, Map<string, PingInfo>>,
): Map<string, Map<string, PingInfo>> {
  const out = new Map<string, Map<string, PingInfo>>();
  for (const src of [a, b]) {
    for (const [gameId, feats] of src) {
      let m = out.get(gameId);
      if (!m) {
        m = new Map();
        out.set(gameId, m);
      }
      for (const [feature, info] of feats) {
        m.set(feature, mergePing(m.get(feature) ?? null, info) as PingInfo);
      }
    }
  }
  return out;
}

/**
 * Lectura completa de evidencia de integración de un proveedor: telemetría
 * observada (IntegrationPing) FUSIONADA con la evidencia derivada de los datos de
 * dominio. Es lo que deben usar las rutas de lectura (proveedor + admin) para no
 * mostrar falsos "No integrado".
 */
export async function readIntegrationEvidence(
  providerId: string,
  gameIds: string[],
): Promise<Map<string, Map<string, PingInfo>>> {
  const [pings, domain] = await Promise.all([
    readProviderPings(providerId),
    deriveDomainEvidence(providerId, gameIds),
  ]);
  return mergeByGame(pings, domain);
}

export type StoreGameRef = { id: string; providerId: string };

/**
 * Puntaje de integración por juego, para ordenar la tienda ("mientras más
 * integración, más arriba"). Es el número de interfaces distintas (§1–§8) que el
 * juego tiene cableadas, combinando telemetría observada (IntegrationPing) con la
 * evidencia derivada del dominio (compras, salas, apuestas, marcadores), igual que
 * el panel de integración. Las features a nivel proveedor (presencia, social,
 * webhooks) cuentan para TODOS los juegos de ese proveedor.
 *
 * A diferencia de readIntegrationEvidence (por proveedor), esto hace un número
 * fijo de consultas agregadas sobre TODOS los juegos a la vez, así no escala con
 * la cantidad de proveedores aunque se llame en cada render de la portada.
 * Devuelve un Map gameId→score (0–8); los juegos sin evidencia quedan en 0.
 */
export async function scoreGamesByIntegration(
  games: StoreGameRef[],
): Promise<Map<string, number>> {
  const score = new Map<string, number>();
  for (const g of games) score.set(g.id, 0);
  if (games.length === 0) return score;

  const gameIds = games.map((g) => g.id);
  const providerIds = [...new Set(games.map((g) => g.providerId))];

  // Features distintas atribuidas a un juego, y a un proveedor (aplican a todos
  // sus juegos). Se usan Sets para contar interfaces únicas, no llamadas.
  const gameFeatures = new Map<string, Set<string>>();
  const providerFeatures = new Map<string, Set<string>>();
  const addGame = (gameId: string, f: string) => {
    let s = gameFeatures.get(gameId);
    if (!s) gameFeatures.set(gameId, (s = new Set()));
    s.add(f);
  };
  const addProvider = (providerId: string, f: string) => {
    let s = providerFeatures.get(providerId);
    if (!s) providerFeatures.set(providerId, (s = new Set()));
    s.add(f);
  };

  const inGames = { gameId: { in: gameIds } };
  const inProviders = { providerId: { in: providerIds } };
  const [
    gamePings,
    providerPings,
    purchases,
    rooms,
    bets,
    leaderboards,
    presence,
    invites,
  ] = await Promise.all([
    // Telemetría atribuida a un juego (gameId != "") y a un proveedor (gameId = "").
    prisma.integrationPing.groupBy({ by: ["gameId", "feature"], where: inGames }),
    prisma.integrationPing.groupBy({
      by: ["providerId", "feature"],
      where: { ...inProviders, gameId: "" },
    }),
    // Evidencia de dominio: su existencia prueba que se ejerció la interfaz.
    prisma.purchase.groupBy({
      by: ["gameId"],
      where: { ...inGames, status: "paid" },
      _count: { _all: true },
    }),
    prisma.room.groupBy({ by: ["gameId"], where: inGames, _count: { _all: true } }),
    prisma.bet.groupBy({ by: ["gameId"], where: inGames, _count: { _all: true } }),
    prisma.leaderboard.findMany({ where: inGames, select: { gameId: true } }),
    prisma.gamePresence.groupBy({
      by: ["providerId"],
      where: inProviders,
      _count: { _all: true },
    }),
    prisma.gameInvite.groupBy({
      by: ["providerId"],
      where: inProviders,
      _count: { _all: true },
    }),
  ]);

  for (const p of gamePings) if (p.gameId) addGame(p.gameId, p.feature);
  for (const p of providerPings) addProvider(p.providerId, p.feature);
  for (const p of purchases) addGame(p.gameId, "purchase");
  for (const r of rooms) addGame(r.gameId, "rooms");
  for (const b of bets) addGame(b.gameId, "bets");
  for (const lb of leaderboards) addGame(lb.gameId, "leaderboards");
  for (const pr of presence) addProvider(pr.providerId, "presence");
  for (const inv of invites) addProvider(inv.providerId, "social");

  // §1 SSO inferido: actividad con identidad de jugador (marcadores/salas/
  // apuestas) solo se consigue tras canjear la sesión/entitlement (§1).
  for (const s of gameFeatures.values()) {
    if (s.has("leaderboards") || s.has("rooms") || s.has("bets")) s.add("sso");
  }

  for (const g of games) {
    const all = new Set<string>(gameFeatures.get(g.id));
    for (const f of providerFeatures.get(g.providerId) ?? []) all.add(f);
    score.set(g.id, all.size);
  }
  return score;
}

export type GameRef = {
  id: string;
  title: string;
  slug: string;
  status: string;
  // Declaración manual de capacidades NGP no observables (Game.manualCaps). JSON
  // { [capKey]: boolean }; ver MANUAL_CAP_KEYS en src/lib/integration-ngp.ts.
  manualCaps?: Record<string, boolean> | null;
  // Modo por capacidad intermedia (Game.capsMode): { [capKey]: "luna" | "nostr" }.
  // "nostr" = migrada a NGP (pata Luna apagada). Ver capability-mode.ts.
  capsMode?: Record<string, string> | null;
};

// Señales de uso de Nostr Games Protocol (NGP) (Nostr) derivables de la DB, por juego:
//   scores   → puntajes kind:31337 ya proyectados a Score (sourceEventId != null)
//   zaps     → propinas/premios NIP-57 (tabla Zap)
//   comments → reseñas/logros kind:1 colgando de la coordenada (GameComment)
//   betsV2   → apuestas por zaps (NIP-57): existe una ZapBet del juego (escrow v2)
// Los retos NIP-17 NO entran acá: van cifrados E2E (capacidad declarada, no
// observable). Ver src/lib/integration-ngp.ts.
export type NostrSignals = Record<string, PingInfo | null>;

export type IntegrationView = {
  provider: {
    id: string;
    name: string;
    webhookConfigured: boolean;
    apiKeys: number;
  };
  // Features a nivel proveedor (presencia, social, webhooks): aplican a todos los
  // juegos. La UI las muestra una vez y/o repetidas en cada juego.
  providerLevel: Record<string, PingInfo | null>;
  games: Array<
    GameRef & {
      features: Record<string, PingInfo | null>;
      // Evidencia NGP observada (null = sin telemetría NGP para este juego).
      nostr?: NostrSignals | null;
    }
  >;
};

const GAME_FEATURES = INTEGRATION_FEATURES.filter((f) => f.scope === "game");
const PROVIDER_FEATURES = INTEGRATION_FEATURES.filter((f) => f.scope === "provider");

/**
 * Arma la vista de integración (telemetría observada) de UN proveedor a partir de
 * sus pings ya indexados. Reutilizado por la ruta del proveedor y la de admin.
 */
export function buildIntegrationView(
  provider: { id: string; name: string; webhookConfigured: boolean; apiKeys: number },
  games: GameRef[],
  byGame: Map<string, Map<string, PingInfo>>,
  nostrByGame?: Map<string, NostrSignals>,
): IntegrationView {
  const providerPings = byGame.get("") ?? new Map<string, PingInfo>();
  const providerLevel: Record<string, PingInfo | null> = {};
  for (const f of PROVIDER_FEATURES) {
    providerLevel[f.key] = providerPings.get(f.key) ?? null;
  }
  return {
    provider,
    providerLevel,
    games: games.map((g) => {
      const gamePings = byGame.get(g.id) ?? new Map<string, PingInfo>();
      const features: Record<string, PingInfo | null> = {};
      for (const f of GAME_FEATURES) {
        features[f.key] = gamePings.get(f.key) ?? null;
      }
      return { ...g, features, nostr: nostrByGame?.get(g.id) ?? null };
    }),
  };
}

/**
 * Evidencia de uso de Nostr Games Protocol (NGP) (Nostr) por juego: puntajes Nostr
 * (Score.sourceEventId), zaps (NIP-57) y reseñas/comentarios (kind:1). Es lo
 * análogo a deriveDomainEvidence pero para NGP; la 1.0 no la conoce. Devuelve
 * un Map gameId→{scores,zaps,comments}; los juegos sin señal quedan fuera del Map.
 */
export async function readNostrEvidence(
  gameIds: string[],
): Promise<Map<string, NostrSignals>> {
  const out = new Map<string, NostrSignals>();
  if (gameIds.length === 0) return out;
  const inGames = { gameId: { in: gameIds } };

  const ensure = (gameId: string): NostrSignals => {
    let r = out.get(gameId);
    if (!r) out.set(gameId, (r = { scores: null, zaps: null, comments: null, betsV2: null }));
    return r;
  };

  const [zaps, comments, scores, betsV2] = await Promise.all([
    prisma.zap.groupBy({
      by: ["gameId"],
      where: inGames,
      _count: { _all: true },
      _min: { zappedAt: true },
      _max: { zappedAt: true },
    }),
    prisma.gameComment.groupBy({
      by: ["gameId"],
      where: inGames,
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    // Score no tiene gameId directo (cuelga de Leaderboard) y solo cuentan los de
    // procedencia NGP (sourceEventId != null) → findMany + agrupado manual.
    prisma.score.findMany({
      where: { leaderboard: { gameId: { in: gameIds } }, sourceEventId: { not: null } },
      select: {
        createdAt: true,
        updatedAt: true,
        leaderboard: { select: { gameId: true } },
      },
    }),
    // Apuestas por zaps (escrow v2): la existencia de una ZapBet prueba que el juego
    // ejerció POST /api/v2/bets (riel NGP). Análogo a `bets` (v1) pero es señal NGP.
    prisma.zapBet.groupBy({
      by: ["gameId"],
      where: inGames,
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
  ]);

  for (const z of zaps) {
    if (!z._min.zappedAt || !z._max.zappedAt) continue;
    ensure(z.gameId).zaps = {
      count: z._count._all,
      firstSeenAt: iso(z._min.zappedAt),
      lastSeenAt: iso(z._max.zappedAt),
    };
  }
  for (const c of comments) {
    if (!c._min.createdAt || !c._max.createdAt) continue;
    ensure(c.gameId).comments = {
      count: c._count._all,
      firstSeenAt: iso(c._min.createdAt),
      lastSeenAt: iso(c._max.createdAt),
    };
  }
  const scoreAgg = new Map<string, PingInfo>();
  for (const s of scores) {
    const gid = s.leaderboard.gameId;
    const info: PingInfo = {
      count: 1,
      firstSeenAt: iso(s.createdAt),
      lastSeenAt: iso(s.updatedAt),
    };
    scoreAgg.set(gid, mergePing(scoreAgg.get(gid) ?? null, info) as PingInfo);
  }
  for (const [gid, info] of scoreAgg) ensure(gid).scores = info;

  for (const b of betsV2) {
    if (!b._min.createdAt || !b._max.createdAt) continue;
    ensure(b.gameId).betsV2 = {
      count: b._count._all,
      firstSeenAt: iso(b._min.createdAt),
      lastSeenAt: iso(b._max.createdAt),
    };
  }

  return out;
}
