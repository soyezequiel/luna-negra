// Instrumentación de servidor (Next 16): se ejecuta una vez al arrancar cada
// instancia. Carga el init de Sentry según el runtime.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    await startEscrowTick();
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

// Captura errores no manejados de route handlers y server components.
export const onRequestError = Sentry.captureRequestError;
