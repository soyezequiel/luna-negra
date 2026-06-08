/**
 * Presencia "Jugando X" (NIP-38) gobernada por el heartbeat del juego.
 *
 * El estado NIP-38 lo firma la pestaña de la tienda con la llave Nostr del
 * usuario (`window.nostr`); el juego corre en OTRA pestaña (a veces de otro
 * dominio) y no puede firmar. Por eso el juego le "late" a su opener (la tienda)
 * con `postMessage({ type: "lunanegra:heartbeat" })` cada ~10s. Mientras lleguen
 * latidos, la tienda mantiene fresco el estado; si pasan más de
 * PRESENCE_TIMEOUT_MS sin latido (juego cerrado, pestaña o navegador caído), lo
 * limpia. Así se elimina el falso positivo de quedar "Jugando" colgado 20 min
 * cuando el cierre limpio no llegaba a correr. Ver `docs/multijugador-contrato.md`.
 */

import { publishPlayingStatus, clearPlayingStatus } from "@/lib/nostr-social";

/** Mensajes que el juego postea a su opener (la tienda). */
export const HEARTBEAT_MESSAGE = "lunanegra:heartbeat";
export const STOPPED_MESSAGE = "lunanegra:stopped";

// Sin latido por más de este lapso ⇒ "no está jugando" (pedido de producto: 20s).
export const PRESENCE_TIMEOUT_MS = 20_000;
// Como mucho cada cuánto re-publicamos el estado NIP-38 al recibir latidos.
const REFRESH_INTERVAL_MS = 12_000;
// Expiración (NIP-40) del estado: mayor que el timeout para no parpadear entre
// latidos, pero corta para que se auto-limpie si hasta la tienda muere.
const STATUS_TTL_S = 30;
// Cada cuánto el watchdog revisa silencio o cierre de la ventana del juego.
const WATCHDOG_INTERVAL_MS = 4_000;

// Una sola sesión de presencia activa a la vez (un juego abierto por vez, igual
// que el watcher de sala en invite.ts).
let activeStop: (() => void) | null = null;

/**
 * Empieza a manejar la presencia "Jugando `title`" gobernada por el heartbeat
 * del juego. `win` es la pestaña del juego recién abierta: validamos que los
 * latidos vengan de ahí. Publica el estado optimista al instante (UX); si el
 * juego nunca late, el watchdog lo baja en ≤20s. Devuelve un stop manual (frena
 * los watchers sin limpiar el estado: lo usa la apertura del próximo juego).
 */
export function startPlayingPresence({
  win,
  title,
  link,
}: {
  win: Window | null;
  title: string;
  link?: string;
}): () => void {
  // Cierra la sesión previa sin limpiar (el estado nuevo pisa al anterior).
  activeStop?.();

  let lastBeat = Date.now();
  let lastPublish = 0;
  let stopped = false;

  const refresh = () => {
    lastPublish = Date.now();
    publishPlayingStatus(title, link, STATUS_TTL_S).catch(() => {});
  };

  const onMessage = (e: MessageEvent) => {
    // Solo aceptamos latidos de la ventana del juego que abrimos.
    if (!win || e.source !== win) return;
    const type = (e.data as { type?: unknown } | null)?.type;
    if (type === HEARTBEAT_MESSAGE) {
      lastBeat = Date.now();
      if (Date.now() - lastPublish >= REFRESH_INTERVAL_MS) refresh();
    } else if (type === STOPPED_MESSAGE) {
      finish(true);
    }
  };

  const watchdog = setInterval(() => {
    const silent = Date.now() - lastBeat > PRESENCE_TIMEOUT_MS;
    const closed = Boolean(win && win.closed);
    if (silent || closed) finish(true);
  }, WATCHDOG_INTERVAL_MS);

  function finish(clear: boolean) {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("message", onMessage);
    clearInterval(watchdog);
    if (activeStop === stop) activeStop = null;
    if (clear) clearPlayingStatus().catch(() => {});
  }

  const stop = () => finish(false);

  window.addEventListener("message", onMessage);
  activeStop = stop;
  // Optimista: aparece al toque; si el juego no late, el watchdog lo baja en ≤20s.
  refresh();

  return stop;
}
