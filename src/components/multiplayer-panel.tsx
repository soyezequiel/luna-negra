"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { publishPlayingStatus } from "@/lib/nostr-social";

type InviteResp = { token: string; roomId: string; host: boolean };

/**
 * Multijugador por **link de invitación** (sin registro de salas en DB):
 * - El dueño crea una sala ("Jugar con amigos") → comparte el link.
 * - Quien abre el link (logueado y dueño del juego) se une con su propio token.
 * El lobby real lo hostea el proveedor; el token se valida en /api/rooms/verify.
 */
export function MultiplayerPanel({
  gameId,
  slug,
  title,
  gameUrl,
}: {
  gameId: string;
  slug: string;
  title: string;
  gameUrl: string;
}) {
  const { user, login } = useSession();
  const params = useSearchParams();
  const roomParam = params.get("room");

  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(
    (token: string, roomId: string) => {
      const url = new URL(gameUrl, window.location.origin);
      url.searchParams.set("inviteToken", token);
      url.searchParams.set("room", roomId);
      window.open(url.toString(), "_blank", "noopener");
      // Presencia NIP-38 "jugando X" con el link de la sala → los amigos pueden
      // unirse desde /friends sin que les pase el link (descubrimiento vía Nostr).
      const link = new URL(
        `/game/${slug}?room=${encodeURIComponent(roomId)}`,
        window.location.origin,
      ).toString();
      publishPlayingStatus(title, link).catch(() => {});
    },
    [gameUrl, slug, title],
  );

  const mintInvite = useCallback(
    async (roomId?: string): Promise<InviteResp | null> => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/games/${gameId}/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roomId ? { roomId } : {}),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(d.error ?? "No se pudo crear la invitación");
          return null;
        }
        return d as InviteResp;
      } finally {
        setLoading(false);
      }
    },
    [gameId],
  );

  async function joinRoom() {
    if (!roomParam) return;
    const d = await mintInvite(roomParam);
    if (d) launch(d.token, d.roomId);
  }

  async function createRoom() {
    const d = await mintInvite();
    if (!d) return;
    setInviteLink(`${window.location.origin}/game/${slug}?room=${d.roomId}`);
    launch(d.token, d.roomId);
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Invitado sin sesión: pedir login.
  if (!user) {
    if (!roomParam) return null;
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
  if (roomParam) {
    return (
      <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
        <p className="text-sm text-zinc-300">
          Te invitaron a la sala <code className="text-sky-300">{roomParam}</code>.
        </p>
        <Button className="mt-3" onClick={joinRoom} disabled={loading}>
          {loading ? "Entrando…" : "Unirse y jugar"}
        </Button>
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
      </div>
    );
  }

  // Modo "host" (dueño creando una sala).
  return (
    <div className="mt-4">
      <Button variant="outline" onClick={createRoom} disabled={loading}>
        {loading ? "Creando sala…" : "🎮 Jugar con amigos"}
      </Button>
      {inviteLink ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-zinc-400">
            Compartí este link con un amigo que también tenga el juego:
          </p>
          <button
            onClick={copyLink}
            className="mt-2 w-full truncate rounded-md border border-white/15 px-3 py-2 text-left font-mono text-xs text-zinc-300 hover:bg-white/5"
          >
            {copied ? "¡Copiado!" : inviteLink}
          </button>
          <p className="mt-2 text-xs text-zinc-500">
            Tu sala ya se abrió en otra pestaña. Cuando tu amigo entre, se ven en
            el lobby.
          </p>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
