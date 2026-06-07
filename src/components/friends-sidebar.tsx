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
  parseInvite,
  getActiveRoom,
  setActiveRoom,
  onActiveRoomChange,
  type ActiveRoom,
  type Invite,
} from "@/lib/invite";
import { launchGameRoom, joinRoomAndPlay } from "@/lib/room-launch";
import { Button } from "@/components/ui/button";

/** Si el estado del amigo apunta a una sala unible, devuelve la invitación. */
function roomInvite(status?: Status): Invite | null {
  return status?.url ? parseInvite(status.url) : null;
}

/** Miembro presente en la sala (roster en vivo del proveedor). */
type RosterMember = { clientId: string; npub: string; host: boolean };

/**
 * Lista de amigos persistente, anclada a la derecha de Luna Negra (visible en
 * pantallas anchas). Cuando el usuario tiene abierta la página de un juego que
 * puede jugar, cada amigo muestra un botón para invitarlo a jugar ese juego.
 *
 * Flujo: invitar **no** abre el juego — solo crea la sala (una vez) y manda el
 * DM. El host invita a quien quiera y, cuando sus amigos hayan entrado, toca
 * "Abrir juego" para entrar a la misma sala ya poblada. Mientras tanto, se
 * sondea la presencia para mostrar cuántos amigos entraron.
 */
export function FriendsSidebar() {
  const { user, login, loading } = useSession();
  const { notify } = useNotify();
  const { currentGame } = useGameContext();
  const { friends } = useFriends();

  const [activeRoom, setActiveRoomState] = useState<ActiveRoom | null>(null);
  const [invitingPk, setInvitingPk] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  // Roster indexado por sala para no mostrar datos de una sala anterior.
  const [roster, setRoster] = useState<{
    roomId: string;
    members: RosterMember[];
  } | null>(null);

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

  // Sala del juego que está abierto (si la creamos en esta sesión de invitación).
  const roomForGame =
    activeRoom && currentGame && activeRoom.slug === currentGame.slug
      ? activeRoom
      : null;

  // Sondeo de presencia: mostramos cuántos amigos ya entraron a la sala. Usamos
  // `leave: true` con un clientId de "espía" para leer el roster sin contarnos.
  const peekRoomId = roomForGame?.hostToken ? roomForGame.roomId : null;
  const peekToken = roomForGame?.hostToken;
  useEffect(() => {
    if (!peekRoomId || !peekToken) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/v1/rooms/${peekRoomId}/presence`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${peekToken}`,
          },
          body: JSON.stringify({ clientId: `peek-${peekRoomId}`, leave: true }),
        });
        const d = await r.json().catch(() => ({}));
        if (!cancelled && r.ok) {
          setRoster({
            roomId: peekRoomId,
            members: Array.isArray(d.members) ? d.members : [],
          });
        }
      } catch {
        /* sin red / proveedor caído: reintentamos en el próximo tick */
      }
    };
    void tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [peekRoomId, peekToken]);

  // Roster que corresponde a la sala del juego abierto (descarta los obsoletos).
  const inRoom =
    roster && roomForGame && roster.roomId === roomForGame.roomId
      ? roster.members
      : null;

  // Crea la sala (una vez) y manda el DM. NO abre el juego: el host lo abre
  // después con "Abrir juego", cuando los invitados ya entraron.
  async function inviteToGame(recipientPubkey: string, name: string) {
    if (!currentGame || invitingPk) return;
    setInvitingPk(recipientPubkey);
    try {
      let room: ActiveRoom | null = roomForGame;

      if (!room) {
        const r = await fetch(`/api/games/${currentGame.gameId}/rooms`, {
          method: "POST",
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "No se pudo crear la sala");
        room = {
          slug: currentGame.slug,
          roomId: d.roomId,
          title: currentGame.title,
          gameUrl: currentGame.gameUrl,
          hostToken: d.token,
        };
        setActiveRoom(room);
        setActiveRoomState(room);
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

  // Abre el juego entrando a la sala ya creada (con quien haya entrado).
  async function openGame() {
    const room = roomForGame;
    if (!room) return;
    // Abrimos la pestaña YA (gesto del click) para esquivar el bloqueo de popups.
    const win = window.open("", "_blank");
    try {
      let token = room.hostToken;
      // Sala sin token guardado (creada en otra sesión/versión): minteamos uno
      // para esta misma sala uniéndonos como miembro.
      if (!token) {
        if (!currentGame) {
          throw new Error("Abrí la página del juego para entrar a la sala");
        }
        const r = await fetch(
          `/api/games/${currentGame.gameId}/rooms/${encodeURIComponent(
            room.roomId,
          )}/members`,
          { method: "POST" },
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "No se pudo entrar a la sala");
        token = d.token;
      }
      if (!token) throw new Error("No se pudo obtener el acceso a la sala");
      const gameUrl = room.gameUrl ?? currentGame?.gameUrl;
      if (!gameUrl) throw new Error("No se encontró el juego de esta sala");
      launchGameRoom({
        gameUrl,
        slug: room.slug,
        title: room.title,
        token,
        roomId: room.roomId,
        win,
      });
    } catch (e) {
      win?.close();
      notify({
        title: "No se pudo abrir el juego",
        body: e instanceof Error ? e.message : undefined,
      });
    }
  }

  // Aceptar una invitación: abrir el juego en pestaña nueva (gesto del click →
  // no lo bloquea el navegador). La tienda queda en esta pestaña.
  function joinRoom(invite: Invite) {
    const win = window.open("", "_blank");
    void joinRoomAndPlay({
      slug: invite.slug,
      roomId: invite.roomId,
      win,
      onError: (body) => notify({ title: "No se pudo unir a la sala", body }),
    });
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
        <div className="border-b border-white/10 bg-emerald-500/10 px-4 py-2.5">
          {roomForGame ? (
            <>
              <button
                onClick={openGame}
                className="w-full rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                ▶ Abrir juego
                {inRoom && inRoom.length > 0
                  ? ` · ${inRoom.length} en la sala`
                  : ""}
              </button>
              <p className="mt-1.5 text-[11px] text-emerald-300/80">
                {inRoom && inRoom.length > 0
                  ? "Tus amigos ya entraron. Abrí el juego cuando quieras."
                  : "Invitaste a tus amigos. Esperando que entren…"}
              </p>
            </>
          ) : (
            <p className="text-xs text-emerald-200">
              🎮 Invitá amigos a jugar{" "}
              <span className="font-medium">{currentGame!.title}</span>. Cuando
              hayan entrado, abrí el juego.
            </p>
          )}
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
              const invite = roomInvite(f.status);
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
                          {invite ? (
                            <button
                              onClick={() => joinRoom(invite)}
                              className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300 hover:bg-emerald-500/30"
                            >
                              Unirse
                            </button>
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
