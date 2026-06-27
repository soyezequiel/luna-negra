// Instrumentación de servidor (Next 16): se ejecuta una vez al arrancar cada
// instancia. Carga el init de Sentry según el runtime.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    await startEscrowTick();
    await startZapSync();
    await startCommentSync();
    await startGameSync();
    await startScoreSync();
    await startPresenceSampler();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
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

  let running = false;
  const tick = async () => {
    if (running) return; // no encimar corridas si una tarda más que el intervalo
    running = true;
    try {
      await runTick();
    } catch (err) {
      console.error("[escrow-tick] falló:", err);
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
      console.error("[zap-sync] falló:", err);
    } finally {
      running = false;
    }
  };

  // Primer sync poco después del arranque, luego periódico.
  setTimeout(tick, 8_000).unref?.();
  setInterval(tick, ZAP_SYNC_INTERVAL_MS).unref?.();
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
      console.error("[comment-sync] falló:", err);
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
      console.error("[game-sync] falló:", err);
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
      console.error("[score-sync] falló:", err);
    } finally {
      running = false;
    }
  };

  // Primer sync poco después del arranque, luego periódico.
  setTimeout(tick, 17_000).unref?.();
  setInterval(tick, SCORE_SYNC_INTERVAL_MS).unref?.();
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
      console.error("[presence-sampler] falló:", err);
    } finally {
      running = false;
    }
  };

  // Primera muestra poco después del arranque, luego periódica.
  setTimeout(tick, 20_000).unref?.();
  setInterval(tick, PRESENCE_SAMPLE_INTERVAL_MS).unref?.();
}

// Captura errores no manejados de route handlers y server components.
export const onRequestError = Sentry.captureRequestError;
