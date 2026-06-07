/**
 * Abre el juego en una pestaña nueva con el token de sala y publica la presencia
 * NIP-38 ("jugando X" con el link de la sala). Compartido por el MultiplayerPanel
 * (página de juego) y la FriendsSidebar (invitar desde cualquier página).
 */

import { publishPlayingStatus, clearPlayingStatus } from "@/lib/nostr-social";
import { inviteHref, watchGameWindow } from "@/lib/invite";

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
  url.searchParams.set("inviteToken", token);
  url.searchParams.set("room", roomId);
  const dest = url.toString();
  if (win) win.location.href = dest;
  else window.open(dest, "_blank", "noopener");

  // Presencia NIP-38 con el link de la sala → los amigos pueden unirse vía Nostr.
  const link = new URL(
    inviteHref({ slug, roomId }),
    window.location.origin,
  ).toString();
  publishPlayingStatus(title, link).catch(() => {});

  // Al cerrar la pestaña del juego: limpiar presencia y sala activa.
  watchGameWindow(win ?? null, () => {
    clearPlayingStatus().catch(() => {});
  });
}

/**
 * Acepta una invitación (slug + roomId) y abre el juego en una pestaña nueva,
 * sin reemplazar la tienda. Pensado para los botones "Unirse" de cualquier
 * página (chat, /friends, sidebar, notificaciones): el caller DEBE abrir la
 * pestaña sincrónicamente dentro del gesto del click y pasarla en `win` para
 * esquivar el bloqueo de popups; la dirigimos recién cuando tenemos el token.
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
  onError?: (message: string) => void;
}): Promise<void> {
  try {
    const r = await fetch("/api/rooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, roomId }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      win?.close();
      onError?.(d.error ?? "No se pudo unir a la sala");
      return;
    }
    launchGameRoom({
      gameUrl: d.gameUrl,
      slug: d.slug,
      title: d.title,
      token: d.token,
      roomId: d.roomId,
      win,
    });
  } catch (e) {
    win?.close();
    onError?.(e instanceof Error ? e.message : "No se pudo unir a la sala");
  }
}
