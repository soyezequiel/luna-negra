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
  // Invitaciones recibidas (DMs): anclan al amigo arriba con opción de unirse.
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  // Roster indexado por sala para no mostrar datos de una sala anterior.
  const [roster, setRoster] = useState<{
    roomId: string;
    members: RosterMember[];
  } | null>(null);

  useEffect(() => {
    setActiveRoomState(getActiveRoom());
    return onActiveRoomChange(() => setActiveRoomState(getActiveRoom()));
  }, []);

  useEffect(() => {
    setPendingInvites(getPendingInvites());
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
      onError: (body) => notify({ title: "No se pudo unir a la sala", body }),
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
        {orphanInvites.length > 0 ? (
          <ul className="mb-2 space-y-1">
            {orphanInvites.map((inv) => (
              <li
                key={inv.fromPubkey}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-2"
              >
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-white/10" />
                  <span className="truncate text-sm font-medium">
                    {shortId(npubOf(inv.fromPubkey))}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-emerald-300">
                  🎮 Te invitó a jugar{" "}
                  <span className="font-medium">{inv.title}</span>
                </p>
                <div className="mt-1 flex gap-1.5">
                  <button
                    onClick={() => joinPendingInvite(inv)}
                    className="flex-1 rounded-md bg-emerald-500/90 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    Unirse
                  </button>
                  <button
                    onClick={() => removePendingInvite(inv.fromPubkey)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
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
            {sortedFriends!.map((f) => {
              const name = profileName(f.profile, shortId(f.npub));
              const invite = roomInvite(f.status);
              const pending = inviteByPk.get(f.pubkey);
              return (
                <li
                  key={f.pubkey}
                  className={
                    pending
                      ? "rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-2"
                      : "rounded-lg px-2 py-2 hover:bg-white/5"
                  }
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
                  {pending ? (
                    <div className="mt-1.5">
                      <p className="text-[11px] text-emerald-300">
                        🎮 Te invitó a jugar{" "}
                        <span className="font-medium">{pending.title}</span>
                      </p>
                      <div className="mt-1 flex gap-1.5">
                        <button
                          onClick={() => joinPendingInvite(pending)}
                          className="flex-1 rounded-md bg-emerald-500/90 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          Unirse
                        </button>
                        <button
                          onClick={() => removePendingInvite(f.pubkey)}
                          className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
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
