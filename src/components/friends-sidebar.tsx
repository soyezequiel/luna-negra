"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import { useNotify } from "@/providers/notifications-provider";
import { useGameContext } from "@/providers/game-context";
import { useFriendsDrawer } from "@/providers/friends-drawer";
import { useFriends } from "@/hooks/use-friends";
import { useOnlyMembers } from "@/hooks/use-friends-filter";
import { cn } from "@/lib/utils";
import {
  FriendSearch,
  globalResultName,
  type FriendSearchResults,
} from "@/components/friend-search";
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
  POPUP_BLOCKED_BODY,
  POPUP_BLOCKED_TITLE,
} from "@/lib/room-launch";
import { sendChallenge } from "@/lib/game-challenge";
import {
  getPendingChallenges,
  onPendingChallengesChange,
  removePendingChallenge,
  type PendingChallenge,
} from "@/lib/challenge-inbox";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
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
 * Flujo: el host primero abre el juego con "Jugar con amigos" — eso crea la
 * sala (una vez) y lanza la pestaña del juego. Recién con el juego abierto se
 * habilitan los botones "Invitar a jugar", que mandan el DM a esa sala. Mientras
 * tanto, se sondea la presencia para mostrar cuántos amigos entraron.
 */
export function FriendsSidebar() {
  const { user, login, loading } = useSession();
  const { notify } = useNotify();
  const { currentGame } = useGameContext();
  const { open: drawerOpen, setOpen: setDrawerOpen } = useFriendsDrawer();
  const { friends, refresh, refreshing } = useFriends();
  const router = useRouter();

  const [activeRoom, setActiveRoomState] = useState<ActiveRoom | null>(() =>
    getActiveRoom(),
  );
  const [invitingPk, setInvitingPk] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  // Retos 1v1 (interfaz 2.0): a quién le mandé reto y quién me retó a mí.
  const [challengingPk, setChallengingPk] = useState<string | null>(null);
  const [challenged, setChallenged] = useState<Set<string>>(new Set());
  const [pendingChallenges, setPendingChallenges] = useState<PendingChallenge[]>(
    () => getPendingChallenges(),
  );
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
  // Resultados del buscador (null = sin query → lista normal).
  const [search, setSearch] = useState<FriendSearchResults | null>(null);
  const onResults = useCallback(
    (r: FriendSearchResults | null) => setSearch(r),
    [],
  );
  // Toggle compartido y persistente: mostrar solo amigos que alguna vez
  // iniciaron en Luna Negra (sincronizado con la página /friends).
  const [onlyMembers, setOnlyMembers] = useOnlyMembers();

  useEffect(() => {
    return onActiveRoomChange(() => setActiveRoomState(getActiveRoom()));
  }, []);

  useEffect(() => {
    return onPendingInvitesChange(() => setPendingInvites(getPendingInvites()));
  }, []);

  useEffect(() => {
    return onPendingChallengesChange(() =>
      setPendingChallenges(getPendingChallenges()),
    );
  }, []);

  // Al cambiar de juego, reseteamos a quién marcamos como invitado. Lo hacemos
  // en render (patrón recomendado por React) y no en un effect.
  const [prevSlug, setPrevSlug] = useState<string | null>(
    currentGame?.slug ?? null,
  );
  if ((currentGame?.slug ?? null) !== prevSlug) {
    setPrevSlug(currentGame?.slug ?? null);
    setInvited(new Set());
    setChallenged(new Set());
  }

  // Sala del juego que está abierto (si la creamos en esta sesión de invitación).
  const roomForGame =
    activeRoom && currentGame && activeRoom.slug === currentGame.slug
      ? activeRoom
      : null;

  // Sondeo de presencia: mostramos cuántos amigos ya entraron a la sala. Usamos
  // `peek: true` para leer el roster sin contarnos NI tocar el estado de la sala.
  // (Mandar `leave: true` con el token de host dispararía el cierre automático y
  // echaría a los invitados antes de que el host abra el juego.)
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
          body: JSON.stringify({ peek: true }),
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

  // Manda el DM de invitación a la sala activa. Requiere el juego abierto: la
  // sala se crea al abrirlo (openGameRoom), no acá. Sin sala, mandamos al host
  // a abrir el juego primero.
  async function inviteToGame(recipientPubkey: string, name: string) {
    if (!currentGame || invitingPk) return;
    const room = roomForGame;
    if (!room) {
      notify({
        title: "Abrí el juego para invitar",
        body: "Tocá «Jugar con amigos» para crear la sala y después invitá.",
      });
      return;
    }
    setInvitingPk(recipientPubkey);
    try {
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

  // Abre el juego: crea la sala la primera vez (host) y lanza la pestaña del
  // juego. Recién con el juego abierto se habilita invitar a los amigos. Si la
  // sala ya existe, reutiliza la pestaña/entra con quien haya entrado.
  async function openGameRoom() {
    if (!currentGame) return;
    const slug = currentGame.slug;
    // Reutilizamos la pestaña del juego si existe; si no, preabrimos una dentro
    // del click para esquivar el bloqueo de popups.
    const win = preopenGameWindowIfNeeded(slug);
    try {
      let room: ActiveRoom | null = roomForGame;
      // Primera vez: creamos la sala y la persistimos como sala activa.
      if (!room) {
        const r = await fetch(`/api/games/${currentGame.gameId}/rooms`, {
          method: "POST",
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "No se pudo crear la sala");
        room = {
          slug,
          roomId: d.roomId,
          title: currentGame.title,
          gameUrl: currentGame.gameUrl,
          hostToken: d.token,
        };
        setActiveRoom(room);
        setActiveRoomState(room);
      }
      let token = room.hostToken;
      // Sala sin token guardado (creada en otra sesión/versión): minteamos uno
      // para esta misma sala uniéndonos como miembro.
      if (!token) {
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
      const gameUrl = room.gameUrl ?? currentGame.gameUrl;
      if (!gameUrl) throw new Error("No se encontró el juego de esta sala");
      const result = launchGameRoom({
        gameUrl,
        slug: room.slug,
        title: room.title,
        token,
        roomId: room.roomId,
        win,
      });
      if (!result.ok) {
        notify({
          title: POPUP_BLOCKED_TITLE,
          body: POPUP_BLOCKED_BODY,
          href: result.dest,
          kind: "warn",
          actionLabel: "Abrir juego",
        });
      }
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
      onBlocked: (dest) =>
        notify({
          title: POPUP_BLOCKED_TITLE,
          body: POPUP_BLOCKED_BODY,
          href: dest,
          kind: "warn",
          actionLabel: "Abrir juego",
        }),
    });
  }

  // Aceptar una invitación recibida por DM: une a la sala y la saca del anclado.
  function joinPendingInvite(invite: PendingInvite) {
    joinRoom(invite);
    removePendingInvite(invite.fromPubkey);
  }

  // Reto 1v1 (interfaz 2.0): manda un DM cifrado NIP-17 que apunta al juego
  // actual. No necesita sala abierta (a diferencia del invite 1.0): se reta desde
  // la página del juego y el otro acepta abriéndolo.
  async function challengeFriend(recipientPubkey: string, name: string) {
    const coord = currentGame?.nostrCoord;
    if (!coord || challengingPk) return;
    setChallengingPk(recipientPubkey);
    try {
      await sendChallenge(recipientPubkey, {
        game: coord,
        message: `Te reté a una partida de ${currentGame!.title}`,
        url: `${window.location.origin}/game/${currentGame!.slug}`,
      });
      setChallenged((prev) => new Set(prev).add(recipientPubkey));
      notify({ title: `Reto enviado a ${name}`, kind: "play" });
    } catch (e) {
      notify({
        title: "No se pudo retar",
        body: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setChallengingPk(null);
    }
  }

  // Aceptar un reto recibido: abrir la página del juego (ahí el otro toca Jugar).
  function acceptChallenge(ch: PendingChallenge) {
    removePendingChallenge(ch.wrapId);
    setDrawerOpen(false);
    router.push(`/game/${ch.slug}`);
  }

  const canInvite = Boolean(currentGame);
  const canChallenge = Boolean(currentGame?.nostrCoord);

  const challengeLabelFor = (pk: string) =>
    challenged.has(pk)
      ? "✓ Retado"
      : challengingPk === pk
        ? "Enviando…"
        : "⚔️ Retar a jugar";
  const challengeDisabledFor = (pk: string) =>
    challenged.has(pk) || challengingPk === pk;

  // Invitaciones recibidas indexadas por emisor, para anclar a ese amigo arriba.
  const inviteByPk = new Map(pendingInvites.map((i) => [i.fromPubkey, i]));

  // Con buscador activo mostramos sus coincidencias locales; si no, la lista
  // completa con las invitaciones pendientes ancladas arriba. El toggle "Solo
  // LN" filtra a los amigos que iniciaron alguna vez en Luna Negra (sin buscador).
  const baseList = search
    ? search.local
    : onlyMembers
      ? friends?.filter((f) => f.isMember) ?? null
      : friends;
  const sortedFriends = baseList
    ? [...baseList].sort(
        (a, b) =>
          (inviteByPk.has(a.pubkey) ? 0 : 1) -
          (inviteByPk.has(b.pubkey) ? 0 : 1),
      )
    : baseList;

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

  // Invitar requiere el juego abierto (sala activa). Sin sala, los botones
  // quedan deshabilitados y el host abre el juego desde el panel de arriba.
  const inviteDisabledFor = (pk: string) =>
    invited.has(pk) || invitingPk === pk || !roomForGame;

  const onlineCount = (friends ?? []).filter((f) => f.status).length;

  return (
    <>
      {/* Overlay del drawer (solo móvil). */}
      <div
        className={cn(
          "fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm transition-opacity duration-[280ms] ln:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setDrawerOpen(false)}
        aria-hidden
      />
      <aside
        className={cn(
          "fixed right-0 top-[66px] bottom-0 z-[60] flex w-[min(360px,88vw)] flex-col border-l border-ln-border bg-ln-bg-deep/95 backdrop-blur transition-transform duration-[280ms]",
          "ln:z-40 ln:w-[308px] ln:translate-x-0 ln:bg-ln-bg-deep/85",
          drawerOpen ? "translate-x-0" : "translate-x-full ln:translate-x-0",
        )}
      >
      {chatWith ? (
        <FriendsChatPanel
          friendPubkey={chatWith.pubkey}
          name={chatWith.name}
          picture={chatWith.picture}
          presence={chatWith.presence}
          online={chatWith.online}
          canInvite={canInvite}
          inviteLabel={inviteLabelFor(chatWith.pubkey)}
          inviteDisabled={inviteDisabledFor(chatWith.pubkey)}
          onInvite={() => inviteToGame(chatWith.pubkey, chatWith.name)}
          onJoinRoom={joinRoom}
          onBack={() => setChatWith(null)}
        />
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
              <Link href="/friends" className="transition-colors hover:text-white">
                Amigos
              </Link>
              {onlineCount > 0 ? (
                <span className="flex items-center gap-1 text-[11px] font-normal text-green">
                  <span className="h-1.5 w-1.5 rounded-full bg-green" />
                  {onlineCount}
                </span>
              ) : null}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void refresh()}
                disabled={refreshing}
                title="Actualizar lista (trae tus follows nuevos)"
                className="text-xs text-muted hover:text-white disabled:opacity-50"
              >
                <span
                  className={
                    refreshing ? "inline-block animate-spin" : undefined
                  }
                >
                  ↻
                </span>
              </button>
              <Link
                href="/friends"
                className="text-xs text-muted hover:text-white"
              >
                Ver todos
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-base text-muted hover:text-white ln:hidden"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
          </div>

          {user ? (
            <div className="border-b border-line px-3 py-2">
              <FriendSearch friends={friends} onResults={onResults} compact />
              {!search && friends && friends.length > 0 ? (
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => setOnlyMembers(!onlyMembers)}
                    aria-pressed={onlyMembers}
                    title="Mostrar solo amigos que iniciaron en Luna Negra"
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                      onlyMembers
                        ? "bg-ln-corona/15 text-ln-corona"
                        : "border border-line text-muted hover:text-ink",
                    )}
                  >
                    <span className="text-[9px]">{onlyMembers ? "✓" : ""}</span>
                    Solo en Luna Negra
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {canInvite ? (
            <div className="border-b border-line bg-green/10 px-4 py-2.5">
              {roomForGame ? (
                <>
                  <Button
                    variant="play"
                    size="sm"
                    className="w-full"
                    onClick={openGameRoom}
                  >
                    ▶ Volver al juego
                    {inRoom && inRoom.length > 0
                      ? ` · ${inRoom.length} en la sala`
                      : ""}
                  </Button>
                  <p className="mt-1.5 text-[11px] text-green/80">
                    {inRoom && inRoom.length > 0
                      ? "Tus amigos ya entraron. Volvé al juego cuando quieras."
                      : "Sala abierta. Invitá a tus amigos desde la lista."}
                  </p>
                </>
              ) : (
                <>
                  <Button
                    variant="play"
                    size="sm"
                    className="w-full"
                    onClick={openGameRoom}
                  >
                    ▶ Jugar con amigos
                  </Button>
                  <p className="mt-1.5 text-[11px] text-green/80">
                    Abrí{" "}
                    <span className="font-medium">{currentGame!.title}</span>{" "}
                    para crear la sala y después invitá a tus amigos.
                  </p>
                </>
              )}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {pendingChallenges.length > 0 ? (
              <ul className="mb-2 space-y-1">
                {pendingChallenges.map((ch) => {
                  const fromFriend = friends?.find(
                    (f) => f.pubkey === ch.fromPubkey,
                  );
                  const name = fromFriend
                    ? profileName(fromFriend.profile, shortId(fromFriend.npub))
                    : shortId(npubOf(ch.fromPubkey));
                  return (
                    <li
                      key={ch.wrapId}
                      className="rounded border border-ln-aurora/40 bg-ln-aurora/10 px-2 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar
                          src={fromFriend?.profile?.picture}
                          seed={name}
                          className="h-8 w-8 shrink-0"
                        />
                        <span className="truncate text-sm font-medium text-ink">
                          {name}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-ln-aurora">
                        ⚔️ {ch.message || "Te retó a una partida"}
                      </p>
                      <div className="mt-1 flex gap-1.5">
                        <button
                          onClick={() => acceptChallenge(ch)}
                          className="btn btn-play flex-1 px-2.5 py-1 text-xs"
                        >
                          Aceptar
                        </button>
                        <button
                          onClick={() => removePendingChallenge(ch.wrapId)}
                          className="shrink-0 rounded-sm px-2 py-1 text-xs text-muted hover:text-ink"
                          aria-label="Rechazar reto"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
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
            ) : !search && onlyMembers && sortedFriends!.length === 0 ? (
              <p className="px-1 text-xs text-muted">
                Ninguno de tus amigos inició en Luna Negra todavía.
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
                            <Avatar
                              src={f.profile?.picture}
                              seed={name}
                              className="h-8 w-8"
                            />
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
                                <span className="shrink-0 rounded-full bg-ln-corona/15 px-1.5 py-0.5 text-[9px] font-medium text-ln-corona">
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
                          disabled={inviteDisabledFor(f.pubkey)}
                          className="mt-1.5 w-full rounded-sm border border-green/40 px-2.5 py-1 text-xs font-medium text-green hover:bg-green/10 disabled:opacity-50"
                        >
                          {inviteLabelFor(f.pubkey)}
                        </button>
                      ) : null}
                      {canChallenge ? (
                        <button
                          onClick={() => challengeFriend(f.pubkey, name)}
                          disabled={challengeDisabledFor(f.pubkey)}
                          className="mt-1.5 w-full rounded-sm border border-ln-aurora/40 px-2.5 py-1 text-xs font-medium text-ln-aurora hover:bg-ln-aurora/10 disabled:opacity-50"
                        >
                          {challengeLabelFor(f.pubkey)}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Resultados de búsqueda global (cuando no está en tus follows). */}
            {search && search.local.length === 0 && search.global.length === 0 ? (
              <p className="px-1 py-2 text-xs text-faint">
                Sin coincidencias. Probá con el nombre completo o el npub.
              </p>
            ) : null}
            {search && search.global.length > 0 ? (
              <div className="mt-2">
                <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
                  En Nostr
                </p>
                <ul className="space-y-1">
                  {search.global.map((g) => {
                    const name = globalResultName(g);
                    return (
                      <li
                        key={g.pubkey}
                        className="rounded px-2 py-2 hover:bg-white/5"
                      >
                        <div className="flex items-center gap-2">
                          <Avatar
                            src={g.profile?.picture}
                            seed={name}
                            className="h-8 w-8 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">
                              {name}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-faint">
                              {g.npub}
                            </span>
                          </span>
                          <Link
                            href={`/messages?to=${g.npub}`}
                            className="shrink-0 rounded-sm border border-line px-2 py-1 text-[10px] text-muted hover:text-ink"
                          >
                            Mensaje
                          </Link>
                        </div>
                        {canInvite ? (
                          <button
                            onClick={() => inviteToGame(g.pubkey, name)}
                            disabled={inviteDisabledFor(g.pubkey)}
                            className="mt-1.5 w-full rounded-sm border border-green/40 px-2.5 py-1 text-xs font-medium text-green hover:bg-green/10 disabled:opacity-50"
                          >
                            {inviteLabelFor(g.pubkey)}
                          </button>
                        ) : null}
                        {canChallenge ? (
                          <button
                            onClick={() => challengeFriend(g.pubkey, name)}
                            disabled={challengeDisabledFor(g.pubkey)}
                            className="mt-1.5 w-full rounded-sm border border-ln-aurora/40 px-2.5 py-1 text-xs font-medium text-ln-aurora hover:bg-ln-aurora/10 disabled:opacity-50"
                          >
                            {challengeLabelFor(g.pubkey)}
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </>
      )}
      </aside>
    </>
  );
}
