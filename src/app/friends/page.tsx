"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { useNotify } from "@/providers/notifications-provider";
import { Button } from "@/components/ui/button";
import { useFriends } from "@/hooks/use-friends";
import {
  publishStatus,
  sendDm,
  profileName,
  shortId,
  type Status,
} from "@/lib/nostr-social";
import {
  buildInviteMessage,
  parseInvite,
  getActiveRoom,
  clearActiveRoom,
  onActiveRoomChange,
  type ActiveRoom,
  type Invite,
} from "@/lib/invite";
import { joinRoomAndPlay } from "@/lib/room-launch";

/** Si el estado del amigo apunta a una sala unible, devuelve la invitación. */
function roomInvite(status?: Status): Invite | null {
  return status?.url ? parseInvite(status.url) : null;
}

export default function FriendsPage() {
  const { user, login, loading } = useSession();
  const { notify } = useNotify();
  const { friends } = useFriends();
  const [statusText, setStatusText] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Sala que el host tiene abierta (si la hay): permite invitar amigos a ella.
  const [activeRoom, setActiveRoomState] = useState<ActiveRoom | null>(null);
  const [invitingPk, setInvitingPk] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  useEffect(() => {
    setActiveRoomState(getActiveRoom());
    // Reaccionar al cierre de la pestaña del juego (o al dismiss): el watcher
    // limpia la sala activa y emite el evento → re-leemos para ocultar el banner.
    return onActiveRoomChange(() => setActiveRoomState(getActiveRoom()));
  }, []);

  async function inviteToActiveRoom(recipientPubkey: string, name: string) {
    if (!activeRoom || invitingPk) return;
    setInvitingPk(recipientPubkey);
    try {
      await sendDm(
        recipientPubkey,
        buildInviteMessage({
          slug: activeRoom.slug,
          roomId: activeRoom.roomId,
          title: activeRoom.title,
          origin: window.location.origin,
        }),
      );
      setInvited((prev) => new Set(prev).add(recipientPubkey));
      notify({ title: `Invitación a ${activeRoom.title} enviada a ${name}` });
    } catch (e) {
      notify({
        title: "No se pudo invitar",
        body: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setInvitingPk(null);
    }
  }

  function dismissActiveRoom() {
    clearActiveRoom();
    setActiveRoomState(null);
  }

  // Aceptar una invitación: reutilizar el juego abierto o preabrir una pestaña
  // dentro del click si todavía no existe.
  function joinRoom(invite: Invite) {
    void joinRoomAndPlay({
      slug: invite.slug,
      roomId: invite.roomId,
      onError: (body) => notify({ title: "No se pudo unir a la sala", body: body ?? undefined }),
    });
  }

  async function setStatus() {
    if (!statusText.trim()) return;
    setStatusMsg(null);
    try {
      await publishStatus(statusText.trim());
      setStatusMsg("Estado publicado en Nostr.");
      setStatusText("");
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "Error");
    }
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Amigos</h1>
        <p className="mt-2 text-zinc-400">
          Conectá tu Nostr para ver a quién seguís.
        </p>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Amigos</h1>

      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4 sm:flex-row">
        <input
          className="flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-500/50"
          placeholder="¿A qué estás jugando? (tu estado)"
          value={statusText}
          onChange={(e) => setStatusText(e.target.value)}
        />
        <Button variant="outline" onClick={setStatus}>
          Publicar estado
        </Button>
      </div>
      {statusMsg ? (
        <p className="mt-2 text-sm text-sky-400">{statusMsg}</p>
      ) : null}

      {activeRoom ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="min-w-0 flex-1 text-sm text-emerald-200">
            🎮 Tenés <span className="font-medium">{activeRoom.title}</span>{" "}
            abierto. Invitá a un amigo a tu sala desde la lista.
          </p>
          <button
            onClick={dismissActiveRoom}
            className="shrink-0 text-xs text-zinc-400 hover:text-zinc-200"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      <div className="mt-6">
        {friends === null ? (
          <p className="text-sm text-zinc-500">Cargando desde relays…</p>
        ) : friends.length === 0 ? (
          <p className="text-zinc-400">
            No seguís a nadie todavía (o tu lista de contactos no está en estos
            relays).
          </p>
        ) : (
          <ul className="space-y-2">
            {friends.map((f) => (
              <li
                key={f.pubkey}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
              >
                {f.profile?.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.profile.picture}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-full bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {profileName(f.profile, shortId(f.npub))}
                    </span>
                    {f.isMember ? (
                      <span className="shrink-0 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-300">
                        Luna Negra
                      </span>
                    ) : null}
                  </div>
                  {f.status ? (
                    <div className="flex items-center gap-2">
                      <p className="truncate text-xs text-emerald-400">
                        🎮 {f.status.content}
                      </p>
                      {roomInvite(f.status) ? (
                        <button
                          onClick={() => joinRoom(roomInvite(f.status)!)}
                          className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/30"
                        >
                          Unirse
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {f.games.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.games.slice(0, 4).map((g) => (
                        <Link
                          key={g.slug}
                          href={`/game/${g.slug}`}
                          className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-white/20"
                        >
                          {g.title}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
                {activeRoom ? (
                  <button
                    onClick={() =>
                      inviteToActiveRoom(
                        f.pubkey,
                        profileName(f.profile, shortId(f.npub)),
                      )
                    }
                    disabled={
                      invited.has(f.pubkey) || invitingPk === f.pubkey
                    }
                    className="shrink-0 rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    {invited.has(f.pubkey)
                      ? "✓ Invitado"
                      : invitingPk === f.pubkey
                        ? "Enviando…"
                        : "Invitar"}
                  </button>
                ) : null}
                {f.isMember ? (
                  <Link href={`/messages?to=${f.npub}`}>
                    <Button variant="outline">Mensaje</Button>
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
