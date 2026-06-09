/**
 * Presencia "Jugando X" (NIP-38) derivada de la API de Luna Negra.
 *
 * El estado NIP-38 lo firma la pestaña de la tienda con la llave Nostr del
 * usuario (`window.nostr`): el JUEGO nunca toca Nostr. El juego solo reporta su
 * presencia a Luna Negra POR LA API —`POST /api/v1/presence` con su API key, o el
 * demo same-origin por `POST /api/demo/presence` con la cookie de sesión—. La
 * tienda sondea su propia presencia (`GET /api/me/playing`): mientras el juego
 * siga reportando, renueva el estado; cuando deja de reportar (TTL vencido al
 * cerrar el juego), lo limpia. Así no hay acoplamiento de ventana (`opener`,
 * `postMessage`) ni el juego necesita saber nada de Nostr.
 * Ver `docs/multijugador-contrato.md`.
 */

import { publishPlayingStatus, clearPlayingStatus } from "@/lib/nostr-social";

// Cada cuánto la tienda consulta su propia presencia y renueva el estado NIP-38.
const POLL_INTERVAL_MS = 8_000;
// Expiración (NIP-40) del estado: mayor que el poll para no parpadear entre
// sondeos, pero corta para que se auto-limpie si la propia tienda muere sin poder
// publicar el `clearPlayingStatus`.
// Aumentado a 120s para ser robusto ante retrasos de red y discrepancias horarias (clock drift).
const STATUS_TTL_S = 120;
// Si el juego NUNCA llega a reportar presencia (no integra la API, o el jugador
// cerró la pestaña al instante), bajamos el estado optimista tras esta gracia.
const STARTUP_GRACE_MS = 30_000;

// Una sola sesión de presencia activa a la vez (un juego abierto por vez).
let activeStop: (() => void) | null = null;

/**
 * Empieza a manejar la presencia "Jugando `title`" leyendo la presencia que el
 * juego reporta a la API. Publica el estado optimista al instante (UX); si el
 * juego nunca reporta, lo baja tras `STARTUP_GRACE_MS`. Devuelve un stop manual
 * (frena el sondeo sin limpiar el estado: lo usa la apertura del próximo juego).
 */
export function startPlayingPresence({
  title,
  link,
}: {
  title: string;
  link?: string;
}): () => void {
  // Cierra la sesión previa sin limpiar (el estado nuevo pisa al anterior).
  activeStop?.();

  let stopped = false;
  let everSeen = false;
  const startedAt = Date.now();

  const refresh = () =>
    publishPlayingStatus(title, link, STATUS_TTL_S).catch(() => {});

  const poll = async () => {
    if (stopped) return;
    let playing = false;
    try {
      const res = await fetch("/api/me/playing", { credentials: "same-origin" });
      playing = res.ok && Boolean((await res.json())?.playing);
    } catch {
      // Fallo de red: no bajamos el estado por eso. Si persiste, el TTL corto lo
      // deja expirar solo (no llamamos a refresh mientras no confirmemos presencia).
      return;
    }
    if (stopped) return;
    if (playing) {
      everSeen = true;
      refresh();
    } else if (everSeen || Date.now() - startedAt > STARTUP_GRACE_MS) {
      // El juego dejó de reportar (cerró) o nunca reportó dentro de la gracia.
      finish(true);
    }
  };

  const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

  function finish(clear: boolean) {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (activeStop === stop) activeStop = null;
    if (clear) clearPlayingStatus().catch(() => {});
  }

  const stop = () => finish(false);

  activeStop = stop;
  // Optimista: aparece al toque; el sondeo confirma o (tras la gracia) lo baja.
  refresh();

  return stop;
}
