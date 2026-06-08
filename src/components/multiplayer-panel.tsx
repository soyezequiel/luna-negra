"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { launchGameRoom, preopenGameWindowIfNeeded } from "@/lib/room-launch";

type InviteResp = { token: string; roomId: string; host: boolean };

/**
 * Aceptar una invitación a sala multijugador desde un link `?room=...`.
 *
 * Crear salas e invitar amigos se hace desde la lista de amigos (sidebar). Acá
 * solo queda el lado del invitado: quien abre el link (logueado y dueño del
 * juego) se une con su propio token. El lobby lo hostea el proveedor; el token
 * se valida en /api/v1/rooms/verify.
 */
export function MultiplayerPanel({
  gameId,
  slug,
  title,
  gameUrl,
  canPlay,
}: {
  gameId: string;
  slug: string;
  title: string;
  gameUrl: string;
  /** El usuario puede jugar ya (lo compró o el juego es gratis) → auto-unirse. */
  canPlay: boolean;
}) {
  const { user, login } = useSession();
  const params = useSearchParams();
  const roomParam = params.get("room");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(
    (token: string, roomId: string, opts?: { win?: Window | null }) => {
      // El juego se abre en la pestaña que el caller ya abrió (esquiva el
      // bloqueo de popups); la tienda queda en esta pestaña.
      launchGameRoom({ gameUrl, slug, title, token, roomId, win: opts?.win });
    },
    [gameUrl, slug, title],
  );

  const post = useCallback(
    async (path: string): Promise<InviteResp | null> => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(path, { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(d.error ?? "No se pudo unir a la sala");
          return null;
        }
        return d as InviteResp;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const joinRoom = useCallback(
    async (opts?: { win?: Window | null }) => {
      if (!roomParam) return;
      const d = await post(
        `/api/games/${gameId}/rooms/${encodeURIComponent(roomParam)}/members`,
      );
      if (d) launch(d.token, d.roomId, opts);
      else opts?.win?.close();
    },
    [roomParam, post, gameId, launch],
  );

  // Aceptar la invitación reutiliza la pestaña del juego si Luna Negra ya la
  // tiene abierta. Si no existe, preabrimos una pestaña dentro del click para
  // esquivar el bloqueo de popups y la dirigimos recién cuando tenemos el token.
  function joinAndPlay() {
    const win = preopenGameWindowIfNeeded(slug);
    void joinRoom({ win });
  }

  // Sin invitación por link no hay nada que mostrar: crear sala / invitar vive
  // en la lista de amigos (sidebar) y jugar solo, en el botón "Jugar".
  if (!roomParam) return null;

  // Invitado sin sesión: pedir login.
  if (!user) {
    return (
      <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
        <p className="text-sm text-zinc-300">
          Te invitaron a una sala. Conectá tu Nostr para unirte.
        </p>
        <Button className="mt-3" onClick={login}>
          Conectar con Nostr
        </Button>
      </div>
    );
  }

  // Modo "unirse" (vino por un link de invitación).
  return (
    <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
      <p className="text-sm text-zinc-300">
        Te invitaron a la sala <code className="text-sky-300">{roomParam}</code>.
      </p>
      <Button className="mt-3" onClick={joinAndPlay} disabled={loading || !canPlay}>
        {loading ? "Entrando…" : "Unirse y jugar"}
      </Button>
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
