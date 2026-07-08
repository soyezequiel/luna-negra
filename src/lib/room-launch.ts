/**
 * Abre o reutiliza la pestaña del juego con el token de sala y arranca la presencia
 * NIP-38 ("jugando X" con el link de la sala), derivada de la presencia que el
 * juego reporta a la API (ver playing-presence.ts). Compartido por el
 * MultiplayerPanel (página de juego) y la FriendsSidebar (invitar desde cualquier
 * página).
 */

import { startPlayingPresence } from "@/lib/playing-presence";
import { inviteHref, watchGameWindow } from "@/lib/invite";

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

/**
 * Abre una URL externa (Luna Room Link autocontenido) en una pestaña nueva sin
 * tocar la pestaña de Luna. Devuelve `false` solo si el navegador bloqueó el
 * popup, para que el caller avise en vez de reemplazar la pestaña actual.
 *
 * OJO: no usamos `window.open(url, "_blank", "noopener")`. Con `noopener` el
 * navegador devuelve `null` AUNQUE la pestaña se haya abierto bien (así lo define
 * la spec de HTML), así que el viejo fallback `if (!w) location.assign(url)`
 * creía que estaba bloqueado y encima navegaba la pestaña de Luna → se abría la
 * pestaña nueva Y se reemplazaba Luna Negra. Abrimos sin `noopener` y anulamos el
 * `opener` a mano; así el `null` de retorno sí significa "popup bloqueado".
 */
export function openExternalGameLink(url: string): boolean {
  const win = window.open(url, "_blank");
  if (!win) return false;
  try {
    win.opener = null;
  } catch {
    /* cross-origin: algunos navegadores no dejan escribir opener; ya está abierta */
  }
  return true;
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
): void {
  if (!win) return;
  gameWindows.set(slug, win);
  if (gameUrl) gameWindowOrigins.set(slug, new URL(gameUrl, window.location.origin).origin);
  try {
    win.opener = null;
  } catch {
    /* algunos navegadores no permiten escribir opener; el handle igual sirve */
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
      win.postMessage(
        { type: LOGOUT_MESSAGE_TYPE },
        gameWindowOrigins.get(slug) ?? "*",
      );
    } catch {
      unregisterGameWindow(slug, win);
    }
  }
}

export function launchStandaloneGame({
  gameUrl,
  slug,
  title,
  token,
  roomId,
  win,
}: {
  gameUrl: string;
  slug?: string;
  title?: string;
  token?: string;
  /** "Luna Room Link": abre el juego en una sala HOSTEADA POR EL JUEGO (`?lnRoom=`).
   * Distinto del par `inviteToken`+`room` de `launchGameRoom` (salas de Luna). La
   * sala no pre-existe: el juego la crea lazy. Ver docs/luna-room-link.md. */
  roomId?: string;
  /** Pestaña abierta sincrónicamente dentro del gesto del click (evita el bloqueo
   * de popups); si no se pasa, se abre una nueva acá. */
  win?: Window | null;
}): LaunchResult {
  const url = new URL(gameUrl, window.location.origin);
  url.searchParams.set("lnOrigin", window.location.origin);
  if (token) url.searchParams.set("lnToken", token);
  if (roomId) url.searchParams.set("lnRoom", roomId);
  const dest = url.toString();
  const existing = slug ? getOpenGameWindow(slug) : null;
  if (existing && win && existing !== win) win.close();
  const opened = existing ?? win ?? null;
  const gameWin =
    opened ?? window.open(dest, slug ? gameWindowTarget(slug) : "_blank");
  if (!gameWin) return { ok: false, reason: "popup-blocked", dest };
  if (opened) navigateGameWindow(opened, dest);
  if (slug) registerGameWindow(slug, gameWin, gameUrl);

  if (title) {
    const link = slug
      ? new URL(`/game/${slug}`, window.location.origin).toString()
      : undefined;
    startPlayingPresence({ title, link, slug });
  }
  return { ok: true };
}

export function launchGameRoom({
  gameUrl,
  slug,
  title,
  token,
  roomId,
  win,
}: {
  gameUrl: string;
  slug: string;
  title: string;
  token: string;
  roomId: string;
  /** Pestaña abierta sincrónicamente dentro del gesto del click (evita el bloqueo
   * de popups); si no se pasa, se abre una nueva acá. */
  win?: Window | null;
}): LaunchResult {
  const url = new URL(gameUrl, window.location.origin);
  url.searchParams.set("lnOrigin", window.location.origin);
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
  registerGameWindow(slug, gameWin, gameUrl);

  // Presencia NIP-38 con el link de la sala → los amigos pueden unirse vía Nostr.
  // La tienda la deriva de la presencia que el juego reporta a la API; al cerrar
  // el juego deja de reportar y el estado se limpia solo.
  const link = new URL(
    inviteHref({ slug, roomId }),
    window.location.origin,
  ).toString();
  startPlayingPresence({ title, link, slug });

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
  if (gameWindows.get(slug) === win) gameWindows.delete(slug);
  if (!gameWindows.has(slug)) gameWindowOrigins.delete(slug);
  const watcher = gameWindowWatchers.get(slug);
  if (watcher) clearInterval(watcher);
  gameWindowWatchers.delete(slug);
}
