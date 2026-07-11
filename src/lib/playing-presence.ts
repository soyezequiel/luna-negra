/**
 * Presencia "Jugando X" (NIP-38) derivada de la API de Luna Negra.
 *
 * El estado NIP-38 lo firma la pestaña de la tienda con la llave Nostr del
 * usuario (`window.nostr`): el JUEGO nunca toca Nostr. (El reporte de presencia
 * por la API REST 1.0 fue retirado; hoy la señal viva es la NIP-38.) La tienda
 * sondea su propia presencia (`GET /api/me/playing`): mientras haya estado, lo
 * renueva; cuando expira (TTL vencido al
 * cerrar el juego), lo limpia. Así no hay acoplamiento de ventana (`opener`,
 * `postMessage`) ni el juego necesita saber nada de Nostr.
 * Ver `docs/multijugador-contrato.md`.
 */

import {
  publishPlayingStatus,
  clearPlayingStatus,
  hasStalePlayingStatus,
  isClickPresenceEnabled,
} from "@/lib/nostr-social";

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

// Reconciliación una vez por carga de página: evita re-consultar relays en cada
// re-render del componente que la dispara.
let reconciledThisLoad = false;

/**
 * Al abrir la tienda: si quedó colgado un estado NIP-38 "jugando X" de una sesión
 * previa (p. ej. se cerró la pestaña de golpe y el `clearPlayingStatus` nunca
 * salió, o expira recién en ~2min), lo pisa con un clear — PERO sólo si la API
 * confirma que el jugador NO está jugando ahora. Así un amigo deja de verte como
 * "Jugando X" apenas reabrís la tienda, sin tener que esperar la expiración ni
 * refrescar. No toca un estado manual ni una sesión de juego real en curso.
 */
export async function reconcilePlayingPresence(pubkey: string): Promise<void> {
  if (reconciledThisLoad) return;
  reconciledThisLoad = true;
  // Si hay una sesión de presencia activa en ESTA pestaña, ella gobierna: no tocar.
  if (activeStop) return;
  try {
    // Si de verdad está jugando (el juego lo reporta por la API), no tocamos nada.
    const res = await fetch("/api/me/playing", { credentials: "same-origin" });
    if (!res.ok) return; // sin confirmación no arriesgamos borrar algo legítimo
    if (Boolean((await res.json())?.playing)) return;
  } catch {
    return;
  }
  if (activeStop) return; // se abrió un juego mientras consultábamos
  if (await hasStalePlayingStatus(pubkey).catch(() => false)) {
    await clearPlayingStatus().catch(() => {});
  }
}

/**
 * Empieza a manejar la presencia "Jugando `title`" leyendo la presencia que el
 * juego reporta a la API. Publica el estado optimista al instante (UX); si el
 * juego nunca reporta, lo baja tras `STARTUP_GRACE_MS`. Devuelve un stop manual
 * (frena el sondeo sin limpiar el estado: lo usa la apertura del próximo juego).
 */
export function startPlayingPresence({
  title,
  link,
  slug,
}: {
  title: string;
  link?: string;
  // Slug del juego: ancla la presencia a su coordenada Nostr (tag `a`), para que
  // el sync de background del server la vea (cuenta "jugando ahora" + detección
  // de la integración de presencia). Sin slug, cae a solo etiqueta `l:luna-negra`.
  slug?: string;
}): () => void {
  // Cierra la sesión previa sin limpiar (el estado nuevo pisa al anterior).
  activeStop?.();

  let stopped = false;
  let everSeen = false;
  const startedAt = Date.now();
  // Último estado in-game que reportó el juego (nivel/puntaje/label libre, ver
  // deriveStateLabel en social.ts). Se actualiza en cada sondeo y viaja en el
  // próximo refresh, así la presencia NIP-38 lo muestra sin republicar aparte.
  let stateLabel: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const refresh = () =>
    publishPlayingStatus(title, link, STATUS_TTL_S, stateLabel, slug).catch(() => {});

  const poll = async () => {
    if (stopped) return;
    let playing = false;
    try {
      const res = await fetch("/api/me/playing", { credentials: "same-origin" });
      const data = res.ok ? await res.json() : null;
      playing = res.ok && Boolean(data?.playing);
      stateLabel = data?.stateLabel ?? null;
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

  function finish(clear: boolean) {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    if (activeStop === stop) activeStop = null;
    if (clear) clearPlayingStatus().catch(() => {});
  }

  const stop = () => finish(false);

  activeStop = stop;

  // El admin puede apagar la presencia optimista al abrir un juego: en ese caso la
  // tienda NO firma ningún estado NIP-38 al hacer click (ni arranca el sondeo), y
  // la única señal de "jugando ahora" es la que firma el propio juego (NGP).
  // Chequeamos el flag antes de publicar; con la config cacheada ~2min esto no
  // agrega latencia perceptible. Si el flag está encendido, arranca como siempre:
  // publica optimista al toque y el sondeo confirma o (tras la gracia) lo baja.
  void isClickPresenceEnabled().then((enabled) => {
    if (stopped) return; // se abrió otro juego mientras resolvíamos el flag
    if (!enabled) {
      // Nada publicado por la tienda → nada que limpiar. Cerramos la sesión.
      finish(false);
      return;
    }
    timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    refresh();
  });

  return stop;
}
