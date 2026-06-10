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
const ENTER_ROOM_MESSAGE_TYPE = "luna-negra:enter-room";
const JOIN_ROOM_ERROR = "No se pudo unir a la sala";

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

export function registerGameWindow(slug: string, win: Window | null): void {
  if (!win) return;
  gameWindows.set(slug, win);
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

export function launchStandaloneGame({
  gameUrl,
  slug,
  title,
  token,
}: {
  gameUrl: string;
  slug?: string;
  title?: string;
  token?: string;
}): void {
  const url = new URL(gameUrl, window.location.origin);
  url.searchParams.set("lnOrigin", window.location.origin);
  if (token) url.searchParams.set("lnToken", token);
  const dest = url.toString();
  const existing = slug ? getOpenGameWindow(slug) : null;
  const gameWin =
    existing ?? window.open(dest, slug ? gameWindowTarget(slug) : "_blank");
  if (existing) navigateGameWindow(existing, dest);
  if (slug) registerGameWindow(slug, gameWin);

  if (title) {
    const link = slug
      ? new URL(`/game/${slug}`, window.location.origin).toString()
      : undefined;
    startPlayingPresence({ title, link });
  }
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
}): void {
  const url = new URL(gameUrl, window.location.origin);
  url.searchParams.set("lnOrigin", window.location.origin);
  url.searchParams.set("inviteToken", token);
  url.searchParams.set("room", roomId);
  const dest = url.toString();
  // Si el juego ya esta abierto desde Luna Negra, reutilizamos esa pestaña.
  const existing = getOpenGameWindow(slug);
  if (existing && win && existing !== win) win.close();
  const gameWin = existing ?? win ?? window.open(dest, gameWindowTarget(slug));
  if (gameWin) {
    const navigated = navigateGameWindow(gameWin, dest);
    if (!navigated) {
      postEnterRoomMessage(gameWin, {
        gameUrl,
        inviteToken: token,
        roomId,
      });
    }
  }
  registerGameWindow(slug, gameWin);

  // Presencia NIP-38 con el link de la sala → los amigos pueden unirse vía Nostr.
  // La tienda la deriva de la presencia que el juego reporta a la API; al cerrar
  // el juego deja de reportar y el estado se limpia solo.
  const link = new URL(
    inviteHref({ slug, roomId }),
    window.location.origin,
  ).toString();
  startPlayingPresence({ title, link });

  // Al cerrar la pestaña del juego: limpiar la sala activa (banner local).
  watchGameWindow(gameWin);
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
}: {
  slug: string;
  roomId: string;
  win?: Window | null;
  onError?: (message: string | null) => void;
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
    launchGameRoom({
      gameUrl: d.gameUrl,
      slug: d.slug,
      title: d.title,
      token: d.token,
      roomId: d.roomId,
      win: pendingWin,
    });
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
  const watcher = gameWindowWatchers.get(slug);
  if (watcher) clearInterval(watcher);
  gameWindowWatchers.delete(slug);
}
