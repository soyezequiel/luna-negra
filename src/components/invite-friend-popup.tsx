"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useFriends, type Friend } from "@/hooks/use-friends";
import { profileName, shortId } from "@/lib/nostr-social";
import { useSession } from "@/providers/session-provider";

type InviteState = "sending" | "sent";

export function InviteFriendPopup({
  gameId,
  roomId,
}: {
  gameId: string;
  roomId: string;
}) {
  const { user, login, loading } = useSession();
  const { friends } = useFriends();
  const [statusByNpub, setStatusByNpub] = useState<Record<string, InviteState>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validContext = Boolean(gameId && roomId);

  async function invite(friend: Friend) {
    if (!validContext || statusByNpub[friend.npub]) return;
    setStatusByNpub((prev) => ({ ...prev, [friend.npub]: "sending" }));
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, roomId, toNpub: friend.npub }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        title?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo invitar");
      setStatusByNpub((prev) => ({ ...prev, [friend.npub]: "sent" }));
      setMessage(`Invitacion enviada a ${friendName(friend)}.`);
    } catch (reason) {
      setStatusByNpub((prev) => {
        const next = { ...prev };
        delete next[friend.npub];
        return next;
      });
      setError(reason instanceof Error ? reason.message : "No se pudo invitar");
    }
  }

  if (loading) return null;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-xl flex-col px-4 py-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">
          Luna Negra
        </p>
        <h1 className="mt-2 text-2xl font-bold">Invitar amigo</h1>
        <p className="mt-1 text-sm text-zinc-400">Sala {roomId || "sin sala"}</p>
      </header>

      {!validContext ? (
        <Notice tone="error">Faltan datos de la sala.</Notice>
      ) : !user ? (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-zinc-300">Conecta tu Nostr para ver amigos.</p>
          <Button className="mt-4 w-full" onClick={login}>
            Conectar con Nostr
          </Button>
        </div>
      ) : (
        <>
          {message ? <Notice tone="ok">{message}</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <FriendList
            friends={friends}
            statusByNpub={statusByNpub}
            onInvite={(friend) => void invite(friend)}
          />
        </>
      )}

      <div className="mt-auto pt-4">
        <Button variant="outline" className="w-full" onClick={() => window.close()}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}

function FriendList({
  friends,
  statusByNpub,
  onInvite,
}: {
  friends: Friend[] | null;
  statusByNpub: Record<string, InviteState>;
  onInvite: (friend: Friend) => void;
}) {
  if (friends === null) {
    return <p className="mt-6 text-sm text-zinc-500">Cargando amigos...</p>;
  }
  if (friends.length === 0) {
    return <p className="mt-6 text-sm text-zinc-400">No hay amigos para mostrar.</p>;
  }
  return (
    <ul className="mt-6 space-y-2">
      {friends.map((friend) => {
        const state = statusByNpub[friend.npub];
        return (
          <li
            key={friend.pubkey}
            className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
          >
            {friend.profile?.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={friend.profile.picture}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-full bg-white/10" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{friendName(friend)}</p>
              <p className="truncate text-xs text-zinc-500">{friend.npub}</p>
            </div>
            <Button
              className="shrink-0"
              variant={state === "sent" ? "outline" : "primary"}
              disabled={Boolean(state)}
              onClick={() => onInvite(friend)}
            >
              {state === "sent" ? "Invitado" : state === "sending" ? "Enviando" : "Invitar"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "ok" | "error";
}) {
  return (
    <p
      className={
        tone === "ok"
          ? "mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
          : "mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
      }
    >
      {children}
    </p>
  );
}

function friendName(friend: Friend): string {
  return profileName(friend.profile, shortId(friend.npub));
}
