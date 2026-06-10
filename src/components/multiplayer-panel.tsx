"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { joinRoomAndPlay } from "@/lib/room-launch";

/**
 * Aceptar una invitacion a sala multijugador desde un link `?room=...`.
 *
 * La aceptacion pasa por `/api/rooms/join`, que deja una orden pendiente para
 * que el juego abierto pueda entrar sin abrir otra pestana.
 */
export function MultiplayerPanel({
  slug,
  canPlay,
}: {
  gameId: string;
  slug: string;
  title: string;
  gameUrl: string;
  /** El usuario puede jugar ya (lo compro o el juego es gratis). */
  canPlay: boolean;
}) {
  const { user, login } = useSession();
  const params = useSearchParams();
  const roomParam = params.get("room");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function joinAndPlay() {
    if (!roomParam) return;
    setLoading(true);
    setError(null);
    try {
      await joinRoomAndPlay({
        slug,
        roomId: roomParam,
        onError: (message) => setError(message ?? "No se pudo unir a la sala"),
      });
    } finally {
      setLoading(false);
    }
  }

  // Sin invitacion por link no hay nada que mostrar: crear sala / invitar vive
  // en la lista de amigos (sidebar) y jugar solo, en el boton "Jugar".
  if (!roomParam) return null;

  if (!user) {
    return (
      <div className="mt-4 rounded border border-blue/30 bg-blue/10 p-4">
        <p className="text-sm text-ink">
          Te invitaron a una sala. Conecta tu Nostr para unirte.
        </p>
        <Button variant="blue" className="mt-3" onClick={login}>
          Conectar con Nostr
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded border border-blue/30 bg-blue/10 p-4">
      <p className="text-sm text-ink">
        Te invitaron a la sala <code className="text-blue">{roomParam}</code>.
      </p>
      <Button
        variant="play"
        className="mt-3"
        onClick={joinAndPlay}
        disabled={loading || !canPlay}
      >
        {loading ? "Entrando..." : "Unirse y jugar"}
      </Button>
      {error ? (
        <p className="mt-2 text-sm text-[var(--lose)]">{error}</p>
      ) : null}
    </div>
  );
}
