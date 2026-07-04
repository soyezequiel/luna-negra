// Instrumentación de servidor (Next 16): se ejecuta una vez al arrancar cada
// instancia. Carga el init de Sentry según el runtime.
import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";
import { notifyOperationalError } from "@/lib/discord";

async function reportBackgroundFailure(source: string, error: unknown): Promise<void> {
  console.error(`[${source}] fallo:`, error);
  await notifyOperationalError({ source, error });
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    void warmUpWalletsAtBoot();
    void warmUpStoreZapProfileAtBoot();
    await startEscrowTick();
    await startZapSync();
    await startZapBetSync();
    await startCommentSync();
    await startGameSync();
    await startScoreSync();
    await startReviewSync();
    await startLivePresenceSync();
    await startPresenceSampler();
    await startStorePresenceSampler();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Pre-calienta los wallets NWC al arrancar la instancia (abre la conexión y
 * puebla el estado de salud) para que la PRIMERA apuesta no pague el handshake en
 * frío ni el peaje de descubrir un wallet caído en el `makeInvoice` del depósito.
 * Fire-and-forget: no bloquea el arranque y nunca lanza. Ver [[nwc-failover-salud-wallets]].
 */
async function warmUpWalletsAtBoot() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { warmUpWallets } = await import("./lib/lightning");
    await warmUpWallets();
  } catch (err) {
    await reportBackgroundFailure("warmup-wallets", err);
  }
}

/**
 * Pre-asegura el perfil zap de la tienda (kind:0 con la Lightning Address) al
 * arrancar: `ensureStoreZapProfile` lee el kind:0 de TODOS los relays (~4-8s) y
 * quizá publica, y es un guard duro de CREAR apuesta v2 — sin este warm-up, la
 * PRIMERA apuesta tras cada deploy pagaba ese costo en línea. Memoizado dentro de
 * ensureStoreZapProfile: las creaciones siguientes son gratis. Fire-and-forget.
 */
async function warmUpStoreZapProfileAtBoot() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!base) return; // sin dominio canónico no hay Lightning Address que asegurar
  try {
    const { ensureStoreZapProfile } = await import("./lib/nostr-server");
    await ensureStoreZapProfile(base.replace(/\/$/, ""));
  } catch (err) {
    await reportBackgroundFailure("warmup-store-zap-profile", err);
  }
}

/**
 * Tick de escrow IN-PROCESS para self-host. Reemplaza al cron de QStash que
 * corría en Vercel: sin esto, las apuestas en `pending_deposits` nunca expiran
 * (ni se cobran timeouts/forfeits) y se acumulan para siempre. Una sola
 * instancia → un setInterval alcanza. El primer tick tras el deploy barre la
 * cola atrasada. Ver src/lib/escrow-tick.ts (runTick) y ESCROW_TICK_INTERVAL_MS.
 */
async function startEscrowTick() {
  // Durante `next build` se ejecuta register(); no arranques timers ahí.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { ESCROW_TICK_INTERVAL_MS } = await import("./lib/escrow-config");
  if (!ESCROW_TICK_INTERVAL_MS || ESCROW_TICK_INTERVAL_MS <= 0) return;

  const { runTick } = await import("./lib/escrow-tick");
  // Apuestas v2 (zaps): mismo scheduler, gateado por BETS_V2_ENABLED. Corre tras
  // el tick v1 en la misma pasada (comparten intervalo y guard `running`).
  const { BETS_V2_ENABLED } = await import("./lib/escrow-v2-config");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas si una tarda más que el intervalo
    running = true;
    try {
      await runTick();
      if (BETS_V2_ENABLED) {
        const { runTickV2 } = await import("./lib/escrow-v2-tick");
        await runTickV2();
      }
    } catch (err) {
      await reportBackgroundFailure("escrow-tick", err);
    } finally {
      running = false;
    }
  };

  // No bloquear el arranque: primer tick a los pocos segundos, luego periódico.
  setTimeout(tick, 5_000).unref?.();
  setInterval(tick, ESCROW_TICK_INTERVAL_MS).unref?.();
}

/**
 * Sync IN-PROCESS de recibos de zap (NIP-57): levanta de relays los kind 9735 de
 * los anuncios de juegos y los persiste en la tabla `Zap` (top de zappers). Mismo
 * patrón que el tick de escrow: una sola instancia → un setInterval alcanza. Ver
 * src/lib/zap-sync.ts (syncZapReceipts) y ZAP_SYNC_INTERVAL_MS.
 */
async function startZapSync() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { ZAP_SYNC_INTERVAL_MS } = await import("./lib/zap-sync");
  if (!ZAP_SYNC_INTERVAL_MS || ZAP_SYNC_INTERVAL_MS <= 0) return;

  const { syncZapReceipts } = await import("./lib/zap-sync");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas
    running = true;
    try {
      await syncZapReceipts();
    } catch (err) {
      await reportBackgroundFailure("zap-sync", err);
    } finally {
      running = false;
    }
  };

  // Primer sync poco después del arranque, luego periódico.
  setTimeout(tick, 8_000).unref?.();
  setInterval(tick, ZAP_SYNC_INTERVAL_MS).unref?.();
}

/**
 * Sync IN-PROCESS de recibos de PAYOUT de apuestas v2 (kind:9735): levanta de
 * relays los recibos que emiten los wallets de los ganadores cuando Luna Negra les
 * zapea el premio, y completa `payoutReceiptId` (auditoría del zap saliente). Mismo
 * patrón que zap-sync. Gateado por BETS_V2_ENABLED. Ver src/lib/zap-bet-sync.ts.
 */
async function startZapBetSync() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { BETS_V2_ENABLED, ZAP_BET_SYNC_INTERVAL_MS } = await import("./lib/escrow-v2-config");
  if (!BETS_V2_ENABLED || !ZAP_BET_SYNC_INTERVAL_MS || ZAP_BET_SYNC_INTERVAL_MS <= 0) return;

  const { syncZapBetReceipts } = await import("./lib/zap-bet-sync");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas
    running = true;
    try {
      await syncZapBetReceipts();
    } catch (err) {
      await reportBackgroundFailure("zap-bet-sync", err);
    } finally {
      running = false;
    }
  };

  // Primer sync poco después del arranque, luego periódico.
  setTimeout(tick, 26_000).unref?.();
  setInterval(tick, ZAP_BET_SYNC_INTERVAL_MS).unref?.();
}

/**
 * Sync IN-PROCESS de comentarios (kind:1): levanta de relays las respuestas al
 * anuncio del juego (tag `t` de Luna Negra) y las cachea en `GameComment` para
 * el centro de notificaciones. Mismo patrón que zap-sync. Ver
 * src/lib/comment-sync.ts (syncGameComments) y COMMENT_SYNC_INTERVAL_MS.
 */
async function startCommentSync() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { COMMENT_SYNC_INTERVAL_MS } = await import("./lib/comment-sync");
  if (!COMMENT_SYNC_INTERVAL_MS || COMMENT_SYNC_INTERVAL_MS <= 0) return;

  const { syncGameComments } = await import("./lib/comment-sync");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas
    running = true;
    try {
      await syncGameComments();
    } catch (err) {
      await reportBackgroundFailure("comment-sync", err);
    } finally {
      running = false;
    }
  };

  // Primer sync poco después del arranque, luego periódico.
  setTimeout(tick, 11_000).unref?.();
  setInterval(tick, COMMENT_SYNC_INTERVAL_MS).unref?.();
}

/**
 * Sync IN-PROCESS de JUEGOS (kind:30023): levanta de relays los artículos NIP-23
 * de la tienda y reconcilia el caché `Game` (fuente de verdad = Nostr). Mismo
 * patrón que zap/comment-sync. Ver src/lib/game-sync.ts (syncGames) y
 * GAME_SYNC_INTERVAL_MS.
 */
async function startGameSync() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { GAME_SYNC_INTERVAL_MS } = await import("./lib/game-sync");
  if (!GAME_SYNC_INTERVAL_MS || GAME_SYNC_INTERVAL_MS <= 0) return;

  const { syncGames } = await import("./lib/game-sync");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas
    running = true;
    try {
      await syncGames();
    } catch (err) {
      await reportBackgroundFailure("game-sync", err);
    } finally {
      running = false;
    }
  };

  // Primer sync poco después del arranque, luego periódico.
  setTimeout(tick, 14_000).unref?.();
  setInterval(tick, GAME_SYNC_INTERVAL_MS).unref?.();
}

/**
 * Sync IN-PROCESS de PUNTAJES (kind:31337, interfaz 2.0): levanta de relays los
 * marcadores firmados por los jugadores y los proyecta a la tabla `Score` (mismo
 * read-model que la API REST 1.0). Mismo patrón que zap/comment/game-sync. Ver
 * src/lib/score-sync.ts (syncScores) y SCORE_SYNC_INTERVAL_MS.
 */
async function startScoreSync() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { SCORE_SYNC_INTERVAL_MS } = await import("./lib/score-sync");
  if (!SCORE_SYNC_INTERVAL_MS || SCORE_SYNC_INTERVAL_MS <= 0) return;

  const { syncScores } = await import("./lib/score-sync");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas
    running = true;
    try {
      await syncScores();
    } catch (err) {
      await reportBackgroundFailure("score-sync", err);
    } finally {
      running = false;
    }
  };

  // Primer sync poco después del arranque, luego periódico.
  setTimeout(tick, 17_000).unref?.();
  setInterval(tick, SCORE_SYNC_INTERVAL_MS).unref?.();
}

/**
 * Sync IN-PROCESS de RESEÑAS (kind:1 con formato de `publishGameReview`,
 * interfaz 2.0): levanta de relays las reseñas firmadas por los jugadores como
 * respuesta al artículo del juego y las proyecta a la tabla `Review` (mismo
 * read-model que la API REST 1.0). Mismo patrón que comment/score-sync. Ver
 * src/lib/review-sync.ts (syncGameReviews) y REVIEW_SYNC_INTERVAL_MS.
 */
async function startReviewSync() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { REVIEW_SYNC_INTERVAL_MS } = await import("./lib/review-sync");
  if (!REVIEW_SYNC_INTERVAL_MS || REVIEW_SYNC_INTERVAL_MS <= 0) return;

  const { syncGameReviews } = await import("./lib/review-sync");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas
    running = true;
    try {
      await syncGameReviews();
    } catch (err) {
      await reportBackgroundFailure("review-sync", err);
    } finally {
      running = false;
    }
  };

  // Primer sync poco después del arranque, luego periódico.
  setTimeout(tick, 29_000).unref?.();
  setInterval(tick, REVIEW_SYNC_INTERVAL_MS).unref?.();
}

/**
 * Sync IN-PROCESS de "jugando ahora" (NIP-38 kind:30315, interfaz 2.0): cuenta
 * los estados frescos anclados a la coordenada de cada juego, para los
 * proveedores que no integran la presencia REST (§3). Mismo patrón que
 * score/review-sync. Ver src/lib/live-presence.ts (syncLivePresence) y
 * LIVE_PRESENCE_SYNC_INTERVAL_MS.
 */
async function startLivePresenceSync() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { LIVE_PRESENCE_SYNC_INTERVAL_MS } = await import("./lib/live-presence");
  if (!LIVE_PRESENCE_SYNC_INTERVAL_MS || LIVE_PRESENCE_SYNC_INTERVAL_MS <= 0) return;

  const { syncLivePresence } = await import("./lib/live-presence");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas
    running = true;
    try {
      await syncLivePresence();
    } catch (err) {
      await reportBackgroundFailure("live-presence-sync", err);
    } finally {
      running = false;
    }
  };

  // Primer sync poco después del arranque, luego periódico.
  setTimeout(tick, 32_000).unref?.();
  setInterval(tick, LIVE_PRESENCE_SYNC_INTERVAL_MS).unref?.();
}

/**
 * Muestreo IN-PROCESS de presencia: cada pocos minutos guarda el conteo de
 * jugadores activos por proveedor en `PlayerCountSample`, para poder dibujar la
 * curva "jugadores concurrentes en el tiempo" (estilo SteamDB) en las pantallas
 * de estadísticas. Mismo patrón que los syncs. Ver src/lib/presence-sampler.ts
 * (samplePresence) y PRESENCE_SAMPLE_INTERVAL_MS.
 */
async function startPresenceSampler() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { PRESENCE_SAMPLE_INTERVAL_MS } = await import("./lib/presence-sampler");
  if (!PRESENCE_SAMPLE_INTERVAL_MS || PRESENCE_SAMPLE_INTERVAL_MS <= 0) return;

  const { samplePresence } = await import("./lib/presence-sampler");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas
    running = true;
    try {
      await samplePresence();
    } catch (err) {
      await reportBackgroundFailure("presence-sampler", err);
    } finally {
      running = false;
    }
  };

  // Primera muestra poco después del arranque, luego periódica.
  setTimeout(tick, 20_000).unref?.();
  setInterval(tick, PRESENCE_SAMPLE_INTERVAL_MS).unref?.();
}

/**
 * Muestreo IN-PROCESS de presencia ONLINE EN LA TIENDA: cada minuto guarda el
 * conteo de usuarios con la web abierta y logueada en `StorePresenceSample`, para
 * la curva "usuarios concurrentes en el tiempo" del admin. Mismo patrón que el
 * sampler de presencia de juegos. Ver src/lib/store-presence-sampler.ts.
 */
async function startStorePresenceSampler() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { STORE_PRESENCE_SAMPLE_INTERVAL_MS } = await import("./lib/store-presence-sampler");
  if (!STORE_PRESENCE_SAMPLE_INTERVAL_MS || STORE_PRESENCE_SAMPLE_INTERVAL_MS <= 0) return;

  const { sampleStorePresence } = await import("./lib/store-presence-sampler");

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas
    running = true;
    try {
      await sampleStorePresence();
    } catch (err) {
      await reportBackgroundFailure("store-presence-sampler", err);
    } finally {
      running = false;
    }
  };

  // Primera muestra poco después del arranque, luego periódica.
  setTimeout(tick, 23_000).unref?.();
  setInterval(tick, STORE_PRESENCE_SAMPLE_INTERVAL_MS).unref?.();
}

// Captura errores no manejados de route handlers, actions y server components.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  Sentry.captureRequestError(error, request, context);
  const digest =
    error && typeof error === "object" && "digest" in error
      ? String(error.digest)
      : undefined;
  await notifyOperationalError({
    source: `next-${context.routeType}`,
    error,
    fingerprint: digest ? `next:${digest}` : undefined,
    context: {
      method: request.method,
      path: request.path.split("?", 1)[0],
      routePath: context.routePath,
      routerKind: context.routerKind,
      ...(digest ? { digest } : {}),
    },
  });
};
