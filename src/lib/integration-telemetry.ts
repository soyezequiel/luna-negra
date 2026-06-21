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

export type GameRef = { id: string; title: string; slug: string; status: string };

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
    GameRef & { features: Record<string, PingInfo | null> }
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
      return { ...g, features };
    }),
  };
}
