"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { useNotify } from "@/providers/notifications-provider";
import { useGameContext } from "@/providers/game-context";
import { useFriends } from "@/hooks/use-friends";
import { profileName, shortId, sendDm, type Status } from "@/lib/nostr-social";
import {
  buildInviteMessage,
  getActiveRoom,
  setActiveRoom,
  onActiveRoomChange,
  type ActiveRoom,
} from "@/lib/invite";
import { launchGameRoom } from "@/lib/room-launch";
import { Button } from "@/components/ui/button";

/** Si el estado del amigo apunta a una sala unible, devuelve el path relativo. */
function roomHref(status?: Status): string | null {
  if (!status?.url) return null;
  try {
    const u = new URL(status.url);
    if (!u.searchParams.get("room")) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/**
 * Lista de amigos persistente, anclada a la derecha de Luna Negra (visible en
 * pantallas anchas). Cuando el usuario tiene abierta la página de un juego que
 * puede jugar, cada amigo muestra un botón para invitarlo a jugar ese juego:
 * la primera invitación crea la sala y abre el juego; las siguientes reutilizan
 * la misma sala.
 */
export function FriendsSidebar() {
  const { user, login, loading } = useSession();
  const { notify } = useNotify();
  const { currentGame } = useGameContext();
  const { friends } = useFriends();

  const [activeRoom, setActiveRoomState] = useState<ActiveRoom | null>(null);
  const [invitingPk, setInvitingPk] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  useEffect(() => {
    setActiveRoomState(getActiveRoom());
    return onActiveRoomChange(() => setActiveRoomState(getActiveRoom()));
  }, []);

  // Al cambiar de juego, reseteamos a quién marcamos como invitado. Lo hacemos
  // en render (patrón recomendado por React) y no en un effect.
  const [prevSlug, setPrevSlug] = useState<string | null>(
    currentGame?.slug ?? null,
  );
  if ((currentGame?.slug ?? null) !== prevSlug) {
    setPrevSlug(currentGame?.slug ?? null);
    setInvited(new Set());
  }

  async function inviteToGame(recipientPubkey: string, name: string) {
    if (!currentGame || invitingPk) return;
    setInvitingPk(recipientPubkey);
    try {
      // Reutilizar la sala activa si es de este mismo juego; si no, crear una.
      let room: ActiveRoom | null =
        activeRoom && activeRoom.slug === currentGame.slug ? activeRoom : null;

      if (!room) {
        // Abrimos la pestaña del juego YA (dentro del gesto del click) para que
        // el navegador no bloquee el popup; la dirigimos recién con el token.
        const win = window.open("", "_blank");
        const r = await fetch(`/api/games/${currentGame.gameId}/rooms`, {
          method: "POST",
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          win?.close();
          throw new Error(d.error ?? "No se pudo crear la sala");
        }
        room = {
          slug: currentGame.slug,
          roomId: d.roomId,
          title: currentGame.title,
        };
        setActiveRoom(room);
        setActiveRoomState(room);
        launchGameRoom({
          gameUrl: currentGame.gameUrl,
          slug: currentGame.slug,
          title: currentGame.title,
          token: d.token,
          roomId: d.roomId,
          win,
        });
      }

      await sendDm(
        recipientPubkey,
        buildInviteMessage({
          slug: room.slug,
          roomId: room.roomId,
          title: room.title,
          origin: window.location.origin,
        }),
      );
      setInvited((prev) => new Set(prev).add(recipientPubkey));
      notify({ title: `Invitación a ${room.title} enviada a ${name}` });
    } catch (e) {
      notify({
        title: "No se pudo invitar",
        body: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setInvitingPk(null);
    }
  }

  const canInvite = Boolean(currentGame);

  return (
    <aside className="fixed right-0 top-14 bottom-0 z-40 hidden w-72 flex-col border-l border-white/10 bg-[#0b0d12]/80 backdrop-blur xl:flex">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Amigos</h2>
        <Link href="/friends" className="text-xs text-zinc-400 hover:text-white">
          Ver todos
        </Link>
      </div>

      {canInvite ? (
        <div className="border-b border-white/10 bg-emerald-500/10 px-4 py-2">
          <p className="text-xs text-emerald-200">
            🎮 Invitá a un amigo a jugar{" "}
            <span className="font-medium">{currentGame!.title}</span>.
          </p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? null : !user ? (
          <div className="px-1 py-2">
            <p className="text-xs text-zinc-400">
              Conectá tu Nostr para ver a tus amigos.
            </p>
            <Button className="mt-3 w-full" onClick={login}>
              Conectar con Nostr
            </Button>
          </div>
        ) : friends === null ? (
          <p className="px-1 text-xs text-zinc-500">Cargando desde relays…</p>
        ) : friends.length === 0 ? (
          <p className="px-1 text-xs text-zinc-400">
            No seguís a nadie todavía en Nostr.
          </p>
        ) : (
          <ul className="space-y-1">
            {friends.map((f) => {
              const name = profileName(f.profile, shortId(f.npub));
              const href = roomHref(f.status);
              return (
                <li
                  key={f.pubkey}
                  className="rounded-lg px-2 py-2 hover:bg-white/5"
                >
                  <div className="flex items-center gap-2">
                    {f.profile?.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.profile.picture}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 shrink-0 rounded-full bg-white/10" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {name}
                        </span>
                        {f.isMember ? (
                          <span className="shrink-0 rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[9px] text-sky-300">
                            LN
                          </span>
                        ) : null}
                      </div>
                      {f.status ? (
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[11px] text-emerald-400">
                            🎮 {f.status.content}
                          </p>
                          {href ? (
                            <Link
                              href={href}
                              className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300 hover:bg-emerald-500/30"
                            >
                              Unirse
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {canInvite ? (
                    <button
                      onClick={() => inviteToGame(f.pubkey, name)}
                      disabled={
                        invited.has(f.pubkey) || invitingPk === f.pubkey
                      }
                      className="mt-1.5 w-full rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      {invited.has(f.pubkey)
                        ? "✓ Invitado"
                        : invitingPk === f.pubkey
                          ? "Enviando…"
                          : "Invitar a jugar"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
