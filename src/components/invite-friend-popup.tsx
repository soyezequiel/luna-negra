"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFriends, type Friend } from "@/hooks/use-friends";
import {
  FriendSearch,
  globalResultName,
  type FriendSearchResults,
} from "@/components/friend-search";
import { profileName, shortId, type GlobalResult } from "@/lib/nostr-social";
import { useSession } from "@/providers/session-provider";

type InviteState = "sending" | "sent";

/** Datos mínimos para invitar: tanto un follow como un resultado global. */
type InviteTarget = { npub: string; name: string; picture: string | null };

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
  // Resultados del buscador (null = sin query → lista normal).
  const [search, setSearch] = useState<FriendSearchResults | null>(null);
  const onResults = useCallback(
    (r: FriendSearchResults | null) => setSearch(r),
    [],
  );

  const validContext = Boolean(gameId && roomId);

  async function invite(target: InviteTarget) {
    if (!validContext || statusByNpub[target.npub]) return;
    setStatusByNpub((prev) => ({ ...prev, [target.npub]: "sending" }));
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, roomId, toNpub: target.npub }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        title?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo invitar");
      setStatusByNpub((prev) => ({ ...prev, [target.npub]: "sent" }));
      setMessage(`Invitacion enviada a ${target.name}.`);
    } catch (reason) {
      setStatusByNpub((prev) => {
        const next = { ...prev };
        delete next[target.npub];
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
          <div className="mt-4">
            <FriendSearch friends={friends} onResults={onResults} />
          </div>
          {search ? (
            <SearchResults
              results={search}
              statusByNpub={statusByNpub}
              onInvite={(target) => void invite(target)}
            />
          ) : (
            <FriendList
              friends={friends}
              statusByNpub={statusByNpub}
              onInvite={(target) => void invite(target)}
            />
          )}
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
  onInvite: (target: InviteTarget) => void;
}) {
  if (friends === null) {
    return <p className="mt-6 text-sm text-zinc-500">Cargando amigos...</p>;
  }
  if (friends.length === 0) {
    return <p className="mt-6 text-sm text-zinc-400">No hay amigos para mostrar.</p>;
  }
  return (
    <ul className="mt-6 space-y-2">
      {friends.map((friend) => (
        <InviteRow
          key={friend.pubkey}
          npub={friend.npub}
          name={friendName(friend)}
          picture={friend.profile?.picture ?? null}
          state={statusByNpub[friend.npub]}
          onInvite={onInvite}
        />
      ))}
    </ul>
  );
}

/** Resultados del buscador: coincidencias en tus follows + búsqueda en Nostr. */
function SearchResults({
  results,
  statusByNpub,
  onInvite,
}: {
  results: FriendSearchResults;
  statusByNpub: Record<string, InviteState>;
  onInvite: (target: InviteTarget) => void;
}) {
  const empty = results.local.length === 0 && results.global.length === 0;
  if (empty) {
    return (
      <p className="mt-6 text-sm text-zinc-400">
        Sin coincidencias. Probá con el nombre completo o el npub.
      </p>
    );
  }
  return (
    <div className="mt-6 space-y-5">
      {results.local.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Tus amigos
          </p>
          <ul className="space-y-2">
            {results.local.map((friend) => (
              <InviteRow
                key={friend.pubkey}
                npub={friend.npub}
                name={friendName(friend)}
                picture={friend.profile?.picture ?? null}
                state={statusByNpub[friend.npub]}
                onInvite={onInvite}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {results.global.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            En Nostr
          </p>
          <ul className="space-y-2">
            {results.global.map((g: GlobalResult) => (
              <InviteRow
                key={g.pubkey}
                npub={g.npub}
                name={globalResultName(g)}
                picture={g.profile?.picture ?? null}
                state={statusByNpub[g.npub]}
                onInvite={onInvite}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function InviteRow({
  npub,
  name,
  picture,
  state,
  onInvite,
}: {
  npub: string;
  name: string;
  picture: string | null;
  state: InviteState | undefined;
  onInvite: (target: InviteTarget) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={picture}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded-full bg-white/10" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-zinc-500">{npub}</p>
      </div>
      <Button
        className="shrink-0"
        variant={state === "sent" ? "outline" : "primary"}
        disabled={Boolean(state)}
        onClick={() => onInvite({ npub, name, picture })}
      >
        {state === "sent" ? "Invitado" : state === "sending" ? "Enviando" : "Invitar"}
      </Button>
    </li>
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
