"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { useNotify } from "@/providers/notifications-provider";
import { useGameContext } from "@/providers/game-context";
import { useFriends } from "@/hooks/use-friends";
import {
  profileName,
  shortId,
  npubOf,
  sendDm,
  type Status,
} from "@/lib/nostr-social";
import {
  buildInviteMessage,
  parseInvite,
  getActiveRoom,
  setActiveRoom,
  onActiveRoomChange,
  getPendingInvites,
  onPendingInvitesChange,
  removePendingInvite,
  type ActiveRoom,
  type Invite,
  type PendingInvite,
} from "@/lib/invite";
import {
  launchGameRoom,
  joinRoomAndPlay,
  preopenGameWindowIfNeeded,
} from "@/lib/room-launch";
import { Button } from "@/components/ui/button";
import { FriendsChatPanel } from "@/components/friends-chat-panel";

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

  const [activeRoom, setActiveRoomState] = useState<ActiveRoom | null>(() =>
    getActiveRoom(),
  );
  const [invitingPk, setInvitingPk] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  // Amigo cuyo chat está abierto (panel dinámico; null = vista de lista).
  const [chatWith, setChatWith] = useState<{
    pubkey: string;
    name: string;
    picture?: string | null;
    presence?: string | null;
    online?: boolean;
  } | null>(null);
  // Invitaciones recibidas (DMs): anclan al amigo arriba con opción de unirse.
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>(() =>
    getPendingInvites(),
  );
  // Roster indexado por sala para no mostrar datos de una sala anterior.
  const [roster, setRoster] = useState<{
    roomId: string;
    members: RosterMember[];
  } | null>(null);

  useEffect(() => {
    return onActiveRoomChange(() => setActiveRoomState(getActiveRoom()));
  }, []);

  useEffect(() => {
    return onPendingInvitesChange(() => setPendingInvites(getPendingInvites()));
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
    // Reutilizamos la pestaña del juego si existe; si no, preabrimos una dentro
    // del click para esquivar el bloqueo de popups.
    const win = preopenGameWindowIfNeeded(room.slug);
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

  // Aceptar una invitación: reutilizar el juego abierto o preabrir una pestaña
  // dentro del click si todavía no existe.
  function joinRoom(invite: Invite) {
    void joinRoomAndPlay({
      slug: invite.slug,
      roomId: invite.roomId,
      onError: (body) => notify({ title: "No se pudo unir a la sala", body: body ?? undefined }),
    });
  }

  // Aceptar una invitación recibida por DM: une a la sala y la saca del anclado.
  function joinPendingInvite(invite: PendingInvite) {
    joinRoom(invite);
    removePendingInvite(invite.fromPubkey);
  }

  const canInvite = Boolean(currentGame);

  // Invitaciones recibidas indexadas por emisor, para anclar a ese amigo arriba.
  const inviteByPk = new Map(pendingInvites.map((i) => [i.fromPubkey, i]));

  // Amigos con invitación pendiente primero (orden estable conserva el resto).
  const sortedFriends = friends
    ? [...friends].sort(
        (a, b) =>
          (inviteByPk.has(a.pubkey) ? 0 : 1) -
          (inviteByPk.has(b.pubkey) ? 0 : 1),
      )
    : friends;

  // Invitaciones de alguien que no seguís: no entran en la lista, las anclamos
  // arriba para que no se pierdan.
  const friendPks = new Set((friends ?? []).map((f) => f.pubkey));
  const orphanInvites = pendingInvites.filter(
    (i) => !friendPks.has(i.fromPubkey),
  );

  const inviteLabelFor = (pk: string) =>
    invited.has(pk)
      ? "✓ Invitado"
      : invitingPk === pk
        ? "Enviando…"
        : "Invitar a jugar";

  const onlineCount = (friends ?? []).filter((f) => f.status).length;

  return (
    <aside className="fixed right-0 top-16 bottom-0 z-40 hidden w-80 flex-col border-l border-line bg-bg-1/85 backdrop-blur xl:flex">
      {chatWith ? (
        <FriendsChatPanel
          friendPubkey={chatWith.pubkey}
          name={chatWith.name}
          picture={chatWith.picture}
          presence={chatWith.presence}
          online={chatWith.online}
          canInvite={canInvite}
          inviteLabel={inviteLabelFor(chatWith.pubkey)}
          inviteDisabled={
            invited.has(chatWith.pubkey) || invitingPk === chatWith.pubkey
          }
          onInvite={() => inviteToGame(chatWith.pubkey, chatWith.name)}
          onJoinRoom={joinRoom}
          onBack={() => setChatWith(null)}
        />
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
              Amigos
              {onlineCount > 0 ? (
                <span className="flex items-center gap-1 text-[11px] font-normal text-green">
                  <span className="h-1.5 w-1.5 rounded-full bg-green" />
                  {onlineCount}
                </span>
              ) : null}
            </h2>
            <Link href="/friends" className="text-xs text-muted hover:text-white">
              Ver todos
            </Link>
          </div>

          {canInvite ? (
            <div className="border-b border-line bg-green/10 px-4 py-2.5">
              {roomForGame ? (
                <>
                  <Button
                    variant="play"
                    size="sm"
                    className="w-full"
                    onClick={openGame}
                  >
                    ▶ Abrir juego
                    {inRoom && inRoom.length > 0
                      ? ` · ${inRoom.length} en la sala`
                      : ""}
                  </Button>
                  <p className="mt-1.5 text-[11px] text-green/80">
                    {inRoom && inRoom.length > 0
                      ? "Tus amigos ya entraron. Abrí el juego cuando quieras."
                      : "Invitaste a tus amigos. Esperando que entren…"}
                  </p>
                </>
              ) : (
                <p className="text-xs text-green">
                  🎮 Invitá amigos a jugar{" "}
                  <span className="font-medium">{currentGame!.title}</span>.
                  Cuando hayan entrado, abrí el juego.
                </p>
              )}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {orphanInvites.length > 0 ? (
              <ul className="mb-2 space-y-1">
                {orphanInvites.map((inv) => (
                  <li
                    key={inv.fromPubkey}
                    className="rounded border border-green/40 bg-green/10 px-2 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 shrink-0 rounded-full bg-panel-3" />
                      <span className="truncate text-sm font-medium text-ink">
                        {shortId(npubOf(inv.fromPubkey))}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-green">
                      🎮 Te invitó a jugar{" "}
                      <span className="font-medium">{inv.title}</span>
                    </p>
                    <div className="mt-1 flex gap-1.5">
                      <button
                        onClick={() => joinPendingInvite(inv)}
                        className="btn btn-play flex-1 px-2.5 py-1 text-xs"
                      >
                        Unirse
                      </button>
                      <button
                        onClick={() => removePendingInvite(inv.fromPubkey)}
                        className="shrink-0 rounded-sm px-2 py-1 text-xs text-muted hover:text-ink"
                        aria-label="Descartar invitación"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {loading ? null : !user ? (
              <div className="px-1 py-2">
                <p className="text-xs text-muted">
                  Conectá tu Nostr para ver a tus amigos.
                </p>
                <Button variant="blue" className="mt-3 w-full" onClick={login}>
                  Conectar con Nostr
                </Button>
              </div>
            ) : friends === null ? (
              <p className="px-1 text-xs text-faint">Cargando desde relays…</p>
            ) : friends.length === 0 ? (
              <p className="px-1 text-xs text-muted">
                No seguís a nadie todavía en Nostr.
              </p>
            ) : (
              <ul className="space-y-1">
                {sortedFriends!.map((f) => {
                  const name = profileName(f.profile, shortId(f.npub));
                  const invite = roomInvite(f.status);
                  const pending = inviteByPk.get(f.pubkey);
                  const online = Boolean(f.status);
                  return (
                    <li
                      key={f.pubkey}
                      className={
                        pending
                          ? "rounded border border-green/40 bg-green/10 px-2 py-2"
                          : "rounded px-2 py-2 hover:bg-white/5"
                      }
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setChatWith({
                              pubkey: f.pubkey,
                              name,
                              picture: f.profile?.picture ?? null,
                              presence: f.status?.content ?? null,
                              online,
                            })
                          }
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          title="Abrir chat"
                        >
                          <span className="relative shrink-0">
                            {f.profile?.picture ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={f.profile.picture}
                                alt=""
                                className="h-8 w-8 rounded-full object-cover"
                              />
                            ) : (
                              <span className="block h-8 w-8 rounded-full bg-panel-3" />
                            )}
                            <span
                              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-1"
                              style={{
                                background: online
                                  ? "var(--online)"
                                  : "var(--faint)",
                              }}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-ink">
                                {name}
                              </span>
                              {f.isMember ? (
                                <span className="shrink-0 rounded-sm bg-blue/20 px-1.5 py-0.5 text-[9px] text-blue">
                                  LN
                                </span>
                              ) : null}
                            </span>
                            {f.status ? (
                              <span className="block truncate text-[11px] text-green">
                                🎮 {f.status.content}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-faint">›</span>
                        </button>
                        {invite ? (
                          <button
                            onClick={() => joinRoom(invite)}
                            className="shrink-0 rounded-sm bg-green/20 px-1.5 py-0.5 text-[9px] font-medium text-green hover:bg-green/30"
                          >
                            Unirse
                          </button>
                        ) : null}
                      </div>
                      {pending ? (
                        <div className="mt-1.5">
                          <p className="text-[11px] text-green">
                            🎮 Te invitó a jugar{" "}
                            <span className="font-medium">{pending.title}</span>
                          </p>
                          <div className="mt-1 flex gap-1.5">
                            <button
                              onClick={() => joinPendingInvite(pending)}
                              className="btn btn-play flex-1 px-2.5 py-1 text-xs"
                            >
                              Unirse
                            </button>
                            <button
                              onClick={() => removePendingInvite(f.pubkey)}
                              className="shrink-0 rounded-sm px-2 py-1 text-xs text-muted hover:text-ink"
                              aria-label="Descartar invitación"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {canInvite ? (
                        <button
                          onClick={() => inviteToGame(f.pubkey, name)}
                          disabled={
                            invited.has(f.pubkey) || invitingPk === f.pubkey
                          }
                          className="mt-1.5 w-full rounded-sm border border-green/40 px-2.5 py-1 text-xs font-medium text-green hover:bg-green/10 disabled:opacity-50"
                        >
                          {inviteLabelFor(f.pubkey)}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
