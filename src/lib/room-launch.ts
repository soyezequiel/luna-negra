/**
 * Abre o reutiliza la pestaña del juego con el token de sala. Compartido por el
 * MultiplayerPanel (página de juego) y la FriendsSidebar (invitar desde cualquier
 * página). La presencia "jugando X" NO se publica desde acá: la firma el PROPIO
 * juego (NGP, NIP-38 anclada a su coordenada) apenas el jugador entra — la tienda
 * solo la detecta (live-presence.ts / selectFreshStatuses).
 */

import { watchGameWindow } from "@/lib/invite";
import {
  disableBalGameWindow,
  registerBalGameWindow,
  unregisterBalGameWindow,
} from "@/lib/bal-launcher";
import { getStoredAppMode } from "@/lib/app-mode";

const gameWindows = new Map<string, Window>();
const gameWindowWatchers = new Map<string, ReturnType<typeof setInterval>>();
const gameWindowOrigins = new Map<string, string>();
const ENTER_ROOM_MESSAGE_TYPE = "luna-negra:enter-room";
const LOGOUT_MESSAGE_TYPE = "luna-negra:logout";
const JOIN_ROOM_ERROR = "No se pudo unir a la sala";

/**
 * Resultado de abrir el juego. `popup-blocked` significa que el navegador
 * (p. ej. Brave con Shields) rechazó el `window.open`: el caller debe avisarle
 * al usuario y ofrecerle reintentar con `dest` (la URL final del juego) dentro
 * de un nuevo gesto de click.
 */
export type LaunchResult =
  | { ok: true }
  | { ok: false; reason: "popup-blocked"; dest: string };

// Copy compartido para el aviso de popup bloqueado (toast en los callers).
export const POPUP_BLOCKED_TITLE = "Tu navegador bloqueó la ventana del juego";
export const POPUP_BLOCKED_BODY =
  "Permití pop-ups para Luna Negra (en Brave: ícono 🛡️ Shields → Pop-ups) o tocá «Abrir juego».";

type ResolvedExternalGame = {
  slug: string;
  title: string;
  balCompatible: boolean;
};

/**
 * Abre un Room Link/reto externo respetando la preferencia DEL receptor.
 *
 * En modo independiente conserva el comportamiento anterior: abre la URL cruda
 * en otra pestaña y corta `opener`. En modo BAL preabre una pestaña dentro del
 * gesto, resuelve server-side si la URL pertenece a un juego publicado y, sólo
 * si ese juego declaró BAL, la registra en el launcher antes de navegarla.
 *
 * La URL compartida nunca se reescribe ni se vuelve a generar: `lnOrigin` es un
 * dato efímero agregado exclusivamente al destino local del receptor.
 */
export async function openExternalGameLink(url: string): Promise<LaunchResult> {
  if (getStoredAppMode() !== "bal") return openUnregisteredExternalGameLink(url);

  // Hay un await antes de conocer slug/compatibilidad. Reservar la pestaña ahora
  // evita que Brave y otros bloqueadores rechacen la apertura posterior.
  const pendingWin = window.open("", "_blank");
  if (!pendingWin) return { ok: false, reason: "popup-blocked", dest: url };

  try {
    const response = await fetch("/api/games/resolve-launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const game = (await response.json().catch(() => null)) as
      | ResolvedExternalGame
      | null;
    if (
      response.ok
      && game?.balCompatible === true
      && typeof game.slug === "string"
      && typeof game.title === "string"
    ) {
      try { pendingWin.name = gameWindowTarget(game.slug); }
      catch { /* el registro en memoria sigue siendo suficiente */ }
      return launchStandaloneGame({
        gameUrl: url,
        slug: game.slug,
        title: game.title,
        win: pendingWin,
        balCompatible: true,
      });
    }
  } catch {
    // Fallar al reconocer una URL no debe impedir que el receptor use el enlace.
  }

  return openUnregisteredExternalGameLink(url, pendingWin);
}

/** Apertura directa sin BAL; mantiene el contrato de seguridad anterior. */
function openUnregisteredExternalGameLink(
  url: string,
  pendingWin?: Window,
): LaunchResult {
  // Sin await conviene navegar en el propio window.open: mantiene exactamente el
  // flujo actual del modo independiente y evita un flash de pestaña vacía.
  const win = pendingWin ?? window.open(url, "_blank");
  if (!win) return { ok: false, reason: "popup-blocked", dest: url };
  try {
    win.opener = null;
  } catch {
    /* cross-origin: algunos navegadores no dejan escribir opener; ya está abierta */
  }
  if (pendingWin) navigateGameWindow(win, url);
  return { ok: true };
}

export function getOpenGameWindow(slug: string): Window | null {
  const win = gameWindows.get(slug);
  if (!win) return null;
  try {
    if (!win.closed) return win;
  } catch {
    return win;
  }
  unregisterGameWindow(slug, win);
  return null;
}

export function preopenGameWindowIfNeeded(slug: string): Window | null {
  return getOpenGameWindow(slug)
    ? null
    : window.open("", gameWindowTarget(slug));
}

export function registerGameWindow(
  slug: string,
  win: Window | null,
  gameUrl?: string,
  gameName?: string,
  balEnabled = getStoredAppMode() === "bal",
  balCompatible = false,
): void {
  if (!win) return;
  gameWindows.set(slug, win);
  if (gameUrl) gameWindowOrigins.set(slug, new URL(gameUrl, window.location.origin).origin);
  if (gameUrl && balEnabled && balCompatible) {
    registerBalGameWindow(slug, gameName ?? slug, win, gameUrl, true);
  } else {
    disableBalGameWindow(win);
  }

  const previous = gameWindowWatchers.get(slug);
  if (previous) clearInterval(previous);
  const watcher = setInterval(() => {
    const current = gameWindows.get(slug);
    if (current !== win) {
      clearInterval(watcher);
      return;
    }
    try {
      if (!win.closed) return;
    } catch {
      return;
    }
    unregisterGameWindow(slug, win);
  }, 2000);
  gameWindowWatchers.set(slug, watcher);
}

export function notifyOpenGameWindowsLogout(): void {
  for (const [slug, win] of gameWindows) {
    try {
      if (win.closed) {
        unregisterGameWindow(slug, win);
        continue;
      }
      const targetOrigin = gameWindowOrigins.get(slug);
      if (!targetOrigin) continue;
      win.postMessage({ type: LOGOUT_MESSAGE_TYPE }, targetOrigin);
    } catch {
      unregisterGameWindow(slug, win);
    }
  }
}

export function launchStandaloneGame({
  gameUrl,
  slug,
  title,
  roomId,
  win,
  balEnabled = getStoredAppMode() === "bal",
  balCompatible = false,
}: {
  gameUrl: string;
  slug?: string;
  title?: string;
  /** "Luna Room Link": abre el juego en una sala HOSTEADA POR EL JUEGO (`?join=`).
   * Distinto del par `inviteToken`+`room` de `launchGameRoom` (salas de Luna). La
   * sala no pre-existe: el juego la crea lazy. Ver docs/luna-room-link.md. */
  roomId?: string;
  /** Pestaña abierta sincrónicamente dentro del gesto del click (evita el bloqueo
   * de popups); si no se pasa, se abre una nueva acá. */
  win?: Window | null;
  /** `false` omite por completo la negociación BAL y conserva el login propio. */
  balEnabled?: boolean;
  /** Declaración del proveedor: el juego implementa Bunker Auto Login. */
  balCompatible?: boolean;
}): LaunchResult {
  const url = new URL(gameUrl, window.location.origin);
  const useBal = balEnabled && balCompatible;
  if (useBal) {
    url.searchParams.set("lnOrigin", window.location.origin);
    url.searchParams.delete("lnBal");
  } else {
    url.searchParams.delete("lnOrigin");
    url.searchParams.set("lnBal", "off");
  }
  if (roomId) url.searchParams.set("join", roomId); // ?join: estándar único (antes ?lnRoom)
  const dest = url.toString();
  const existing = slug ? getOpenGameWindow(slug) : null;
  if (existing && win && existing !== win) win.close();
  const opened = existing ?? win ?? null;
  const gameWin =
    opened ?? window.open(dest, slug ? gameWindowTarget(slug) : "_blank");
  if (!gameWin) return { ok: false, reason: "popup-blocked", dest };
  if (opened) navigateGameWindow(opened, dest);
  if (slug) registerGameWindow(slug, gameWin, gameUrl, title, useBal, balCompatible);
  return { ok: true };
}

export function launchGameRoom({
  gameUrl,
  slug,
  title,
  token,
  roomId,
  win,
  balEnabled = getStoredAppMode() === "bal",
  balCompatible = false,
}: {
  gameUrl: string;
  slug: string;
  title: string;
  token: string;
  roomId: string;
  /** Pestaña abierta sincrónicamente dentro del gesto del click (evita el bloqueo
   * de popups); si no se pasa, se abre una nueva acá. */
  win?: Window | null;
  /** Respeta el selector global; false deja autenticación y permisos al juego. */
  balEnabled?: boolean;
  balCompatible?: boolean;
}): LaunchResult {
  const url = new URL(gameUrl, window.location.origin);
  const useBal = balEnabled && balCompatible;
  if (useBal) {
    url.searchParams.set("lnOrigin", window.location.origin);
    url.searchParams.delete("lnBal");
  } else {
    url.searchParams.delete("lnOrigin");
    url.searchParams.set("lnBal", "off");
  }
  url.searchParams.set("inviteToken", token);
  url.searchParams.set("room", roomId);
  const dest = url.toString();
  // Si el juego ya esta abierto desde Luna Negra, reutilizamos esa pestaña.
  const existing = getOpenGameWindow(slug);
  if (existing && win && existing !== win) win.close();
  const gameWin = existing ?? win ?? window.open(dest, gameWindowTarget(slug));
  // Popup bloqueado (Brave Shields, etc.): no hay ventana → avisar al caller en
  // vez de fallar en silencio. No se arranca presencia ni watcher.
  if (!gameWin) return { ok: false, reason: "popup-blocked", dest };
  const navigated = navigateGameWindow(gameWin, dest);
  if (!navigated) {
    postEnterRoomMessage(gameWin, {
      gameUrl,
      inviteToken: token,
      roomId,
    });
  }
  registerGameWindow(slug, gameWin, gameUrl, title, useBal, balCompatible);

  // Al cerrar la pestaña del juego: limpiar la sala activa (banner local).
  watchGameWindow(gameWin);
  return { ok: true };
}

/**
 * Acepta una invitación (slug + roomId) y entra al juego sin reemplazar la
 * tienda. Si Luna Negra ya tiene la pestaña del juego abierta, la reutiliza; si
 * no, el caller puede pasar una pestaña preabierta en `win` para esquivar el
 * bloqueo de popups mientras esperamos el token.
 */
export async function joinRoomAndPlay({
  slug,
  roomId,
  win,
  onError,
  onBlocked,
}: {
  slug: string;
  roomId: string;
  win?: Window | null;
  onError?: (message: string | null) => void;
  /** El navegador bloqueó la ventana del juego: avisar al usuario y ofrecerle
   * abrir `dest` (URL final) en un nuevo gesto de click. */
  onBlocked?: (dest: string) => void;
}): Promise<void> {
  const pendingWin = win ?? preopenGameWindowIfNeeded(slug);
  try {
    const r = await fetch("/api/rooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, roomId }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      pendingWin?.close();
      onError?.(joinRoomErrorDetail(d.error));
      return;
    }
    const existing = getOpenGameWindow(d.slug ?? slug);
    if (d.openGame === true && !existing) {
      pendingWin?.close();
      return;
    }
    const result = launchGameRoom({
      gameUrl: d.gameUrl,
      slug: d.slug,
      title: d.title,
      token: d.token,
      roomId: d.roomId,
      win: pendingWin,
      balCompatible: d.balCompatible === true,
    });
    if (!result.ok) {
      if (onBlocked) onBlocked(result.dest);
      else onError?.(POPUP_BLOCKED_BODY);
    }
  } catch (e) {
    pendingWin?.close();
    onError?.(joinRoomErrorDetail(e instanceof Error ? e.message : null));
  }
}

function joinRoomErrorDetail(value: unknown): string | null {
  const message = typeof value === "string" ? value.trim() : "";
  return message && message !== JOIN_ROOM_ERROR ? message : null;
}

function navigateGameWindow(win: Window, dest: string): boolean {
  try {
    win.location.href = dest;
    win.focus();
    return true;
  } catch {
    return false;
  }
}

function gameWindowTarget(slug: string): string {
  return `luna-negra-game-${slug.replace(/[^a-z0-9_-]/gi, "_")}`;
}

function postEnterRoomMessage(
  win: Window,
  {
    gameUrl,
    inviteToken,
    roomId,
  }: { gameUrl: string; inviteToken: string; roomId: string },
): void {
  try {
    const targetOrigin = new URL(gameUrl, window.location.origin).origin;
    win.postMessage(
      {
        type: ENTER_ROOM_MESSAGE_TYPE,
        inviteToken,
        roomId,
      },
      targetOrigin,
    );
    win.focus();
  } catch {
    /* si la ventana ya no acepta mensajes, el usuario conserva el error visible */
  }
}

function unregisterGameWindow(slug: string, win: Window): void {
  unregisterBalGameWindow(win);
  if (gameWindows.get(slug) === win) gameWindows.delete(slug);
  if (!gameWindows.has(slug)) gameWindowOrigins.delete(slug);
  const watcher = gameWindowWatchers.get(slug);
  if (watcher) clearInterval(watcher);
  gameWindowWatchers.delete(slug);
}
