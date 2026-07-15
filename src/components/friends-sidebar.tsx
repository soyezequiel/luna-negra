"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { useNotify } from "@/providers/notifications-provider";
import { useGameContext, type CurrentGame } from "@/providers/game-context";
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
  launchStandaloneGame,
  joinRoomAndPlay,
  preopenGameWindowIfNeeded,
  getOpenGameWindow,
  openExternalGameLink,
  POPUP_BLOCKED_BODY,
  POPUP_BLOCKED_TITLE,
} from "@/lib/room-launch";
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

  const [activeRoom, setActiveRoomState] = useState<ActiveRoom | null>(null);
  const [invitingPk, setInvitingPk] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  // Sala compartida para "Luna Room Link" (sala hosteada por el juego): se fija una
  // vez por sesión de invitación y se reusa en el open del host y en cada invitado,
  // para que todos caigan en la MISMA sala. Distinta de `activeRoom` (salas de Luna).
  const [linkRoomId, setLinkRoomId] = useState<string | null>(null);
  const isRoomLink = Boolean(currentGame?.roomLink);
  // Amigo cuyo chat está abierto (panel dinámico; null = vista de lista).
  const [chatWith, setChatWith] = useState<{
    pubkey: string;
    name: string;
    picture?: string | null;
    presence?: string | null;
    online?: boolean;
  } | null>(null);
  // Invitaciones recibidas (DMs): anclan al amigo arriba con opción de unirse.
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  // Roster indexado por sala para no mostrar datos de una sala anterior.
  const [roster, setRoster] = useState<{
    roomId: string;
    members: RosterMember[];
  } | null>(null);
  // Resultados del buscador (null = sin query → lista normal).
  const [search, setSearch] = useState<FriendSearchResults | null>(null);
  const [friendCodeCopied, setFriendCodeCopied] = useState(false);
  const onResults = useCallback(
    (r: FriendSearchResults | null) => setSearch(r),
    [],
  );
  // Toggle compartido y persistente: mostrar solo amigos que alguna vez
  // iniciaron en Luna Negra (sincronizado con la página /friends).
  const [onlyMembers, setOnlyMembers] = useOnlyMembers();

  async function copyFriendCode() {
    if (user?.friendCode == null) return;
    try {
      await navigator.clipboard.writeText(String(user.friendCode));
      setFriendCodeCopied(true);
      notify({ title: "Código de amistad copiado" });
      window.setTimeout(() => setFriendCodeCopied(false), 1500);
    } catch {
      notify({ title: "No se pudo copiar el código" });
    }
  }

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (!cancelled) setActiveRoomState(getActiveRoom());
    };
    const unsubscribe = onActiveRoomChange(sync);
    queueMicrotask(sync);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (!cancelled) setPendingInvites(getPendingInvites());
    };
    const unsubscribe = onPendingInvitesChange(sync);
    queueMicrotask(sync);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Al cambiar de juego, reseteamos a quién marcamos como invitado. Lo hacemos
  // en render (patrón recomendado por React) y no en un effect.
  const [prevSlug, setPrevSlug] = useState<string | null>(
    currentGame?.slug ?? null,
  );
  if ((currentGame?.slug ?? null) !== prevSlug) {
    setPrevSlug(currentGame?.slug ?? null);
    setInvited(new Set());
    setLinkRoomId(null);
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
        const r = await fetch(`/api/rooms/${peekRoomId}/presence`, {
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

  // Despacha el "Invitar a jugar": si el juego soporta Luna Room Link (sala del
  // propio juego) usa un enlace general `?join=`; si no, el flujo clásico de
  // salas hosteadas por Luna (DM con `/game/<slug>?room=`).
  function handleInvite(recipientPubkey: string, name: string) {
    if (isRoomLink) void inviteViaRoomLink(recipientPubkey, name);
    else void inviteToGame(recipientPubkey, name);
  }

  // "Luna Room Link" general: pide a Luna un enlace público con el dominio del
  // juego y lo manda por DM. Si el host todavía NO tiene el juego abierto en la
  // sala, lo abre automáticamente (para quedar esperando adentro). Reusa
  // `linkRoomId` para que todos —host e invitados— caigan en la misma sala.
  async function inviteViaRoomLink(recipientPubkey: string, name: string) {
    if (!currentGame || invitingPk) return;
    const game = currentGame;
    // ¿El host ya tiene el juego abierto? Si no, preabrimos la ventana DENTRO del
    // gesto del click (evita el bloqueo de popups) para meterlo en la sala después.
    const alreadyOpen = Boolean(getOpenGameWindow(game.slug));
    const win = alreadyOpen ? null : preopenGameWindowIfNeeded(game.slug);
    // Una vez que abrimos el juego del host en la sala, `win` ya no debe cerrarse
    // si algo posterior (p. ej. el DM) falla: el host quedaría afuera de su propia sala.
    let opened = false;
    setInvitingPk(recipientPubkey);
    try {
      const r = await fetch("/api/rooms/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: game.gameId,
          roomId: linkRoomId ?? undefined,
          // El enlace es ABIERTO igual; `toNpub` solo le dice a Luna a qué amigo
          // encolarle la orden de entrada (`queueRoomLinkLaunchRequest`) para que
          // su Tetra YA ABIERTO muestre el popup. Sin `toNpub` no se encola nada,
          // así que el juego abierto nunca recibe el aviso (solo llega el DM).
          toNpub: npubOf(recipientPubkey),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.inviteUrl) {
        throw new Error(d.error ?? "No se pudo crear la invitación");
      }
      const roomId = (typeof d.roomId === "string" ? d.roomId : linkRoomId) ?? "";
      if (!linkRoomId && roomId) setLinkRoomId(roomId);

      // Meter al host en la sala si no estaba ya adentro (juego cerrado).
      if (!alreadyOpen && roomId) {
        await openHostInRoom(game, roomId, win);
        opened = true;
      } else {
        win?.close();
      }

      await sendDm(
        recipientPubkey,
        `Te invito a jugar ${game.title} en Luna Negra 🎮\n${d.inviteUrl}`,
      );
      setInvited((prev) => new Set(prev).add(recipientPubkey));
      notify({ title: `Invitación a ${game.title} enviada a ${name}` });
    } catch (e) {
      if (!opened) win?.close();
      notify({
        title: "No se pudo invitar",
        body: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setInvitingPk(null);
    }
  }

  // Verifica el acceso y abre el juego del host en la sala room-link (`?join=`),
  // reutilizando la ventana `win` preabierta en el gesto del click si la hay.
  async function openHostInRoom(
    game: CurrentGame,
    roomId: string,
    win: Window | null,
  ) {
    const sr = await fetch(`/api/games/${game.gameId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomLink: true }),
    });
    const sd = await sr.json().catch(() => ({}));
    // La identidad la resuelve el juego por Nostr (NIP-07/46): abrimos con el link
    // limpio (solo ?join + lnOrigin). Solo tiramos si falla el HTTP o el endpoint
    // no confirmó el acceso.
    if (!sr.ok || !sd.nostrLogin) {
      throw new Error(sd.error ?? "No se pudo abrir el juego");
    }
    const result = launchStandaloneGame({
      gameUrl: game.gameUrl,
      slug: game.slug,
      title: game.title,
      roomId,
      win,
      balCompatible: game.balCompatible === true,
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
  }

  // El host abre SU juego en la sala room-link compartida (`?join=`). No crea una
  // fila Room en Luna: la sala vive en el backend del juego, creada al primer acceso.
  async function openRoomLinkGame() {
    if (!currentGame) return;
    const game = currentGame;
    const win = preopenGameWindowIfNeeded(game.slug);
    try {
      let roomId = linkRoomId;
      if (!roomId) {
        const r = await fetch("/api/rooms/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId: game.gameId }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.roomId) throw new Error(d.error ?? "No se pudo crear la sala");
        roomId = d.roomId as string;
        setLinkRoomId(roomId);
      }
      await openHostInRoom(game, roomId, win);
    } catch (e) {
      win?.close();
      notify({
        title: "No se pudo abrir el juego",
        body: e instanceof Error ? e.message : undefined,
      });
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
          balCompatible: currentGame.balCompatible === true,
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
        balCompatible:
          room.balCompatible === true || currentGame.balCompatible === true,
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

  // Aceptar una invitación: para salas de Luna reutiliza/abre la pestaña del juego;
  // para Luna Room Link abre la URL del dominio del juego (autocontenida).
  function openGameLink(url: string) {
    void openExternalGameLink(url).then((result) => {
      if (result.ok) return;
      notify({
        title: POPUP_BLOCKED_TITLE,
        body: POPUP_BLOCKED_BODY,
        href: result.dest,
        kind: "warn",
        actionLabel: "Abrir juego",
      });
    });
  }

  function joinRoom(invite: { slug?: string; roomId: string; url?: string }) {
    if (invite.url) {
      // Room-link autocontenido: abrir en pestaña nueva sin reemplazar Luna. Si el
      // navegador lo bloquea, avisar con un toast (un nuevo gesto reintenta).
      openGameLink(invite.url);
      return;
    }
    if (!invite.slug) return;
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

  const canInvite = Boolean(currentGame);

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

  // Con salas de Luna, invitar requiere el juego abierto (sala activa). Con Luna
  // Room Link no: Luna arma un enlace general sin abrir el juego, así que el botón
  // queda habilitado directamente.
  const inviteDisabledFor = (pk: string) =>
    invited.has(pk) || invitingPk === pk || (!isRoomLink && !roomForGame);

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
          onInvite={() => handleInvite(chatWith.pubkey, chatWith.name)}
          onJoinRoom={joinRoom}
          onOpenGameLink={openGameLink}
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
              <div className="mt-2 flex min-h-6 items-center justify-between gap-2">
                {user.friendCode != null ? (
                  <button
                    type="button"
                    onClick={copyFriendCode}
                    title="Copiar tu código de amistad"
                    aria-label={`Copiar código de amistad ${user.friendCode}`}
                    className="flex min-w-0 items-center gap-1.5 rounded-full border border-ln-luna/30 bg-ln-luna/10 px-2 py-0.5 text-[10px] font-medium text-ln-luna transition-colors hover:border-ln-luna/50 hover:bg-ln-luna/15"
                  >
                    <span className="truncate text-ln-muted">Tu código</span>
                    <span className="shrink-0 font-mono font-bold text-ln-luna-bright">
                      #{user.friendCode}
                    </span>
                    <span className="shrink-0" aria-hidden>
                      {friendCodeCopied ? "✓" : "⧉"}
                    </span>
                  </button>
                ) : (
                  <span />
                )}
                {!search && friends && friends.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setOnlyMembers(!onlyMembers)}
                    aria-pressed={onlyMembers}
                    title="Mostrar solo amigos que iniciaron en Luna Negra"
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                      onlyMembers
                        ? "bg-ln-corona/15 text-ln-corona"
                        : "border border-line text-muted hover:text-ink",
                    )}
                  >
                    <span className="text-[9px]">{onlyMembers ? "✓" : ""}</span>
                    Solo en Luna Negra
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {canInvite ? (
            <div className="border-b border-line bg-green/10 px-4 py-2.5">
              {isRoomLink ? (
                <>
                  <Button
                    variant="play"
                    size="sm"
                    className="w-full"
                    onClick={openRoomLinkGame}
                  >
                    {linkRoomId ? "▶ Entrar a la sala" : "▶ Jugar con amigos"}
                  </Button>
                  <p className="mt-1.5 text-[11px] text-green/80">
                    {linkRoomId
                      ? "Entrá vos también con este botón; tus amigos se suman al tocar «Unirse»."
                      : "Invitá a tus amigos desde la lista: el enlace los lleva directo a tu sala."}
                  </p>
                </>
              ) : roomForGame ? (
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
                  Iniciá sesión para ver a tus amigos.
                </p>
                <Button variant="blue" className="mt-3 w-full" onClick={login}>
                  Iniciar sesión
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
                  // "Conectado" = jugando (NIP-38) o con la web abierta
                  // (StorePresence). El OR cubre al jugador que tiene sólo la
                  // ventana del juego abierta y no la de la tienda.
                  const online = Boolean(f.status) || Boolean(f.onlineInStore);
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
                            ) : f.onlineInStore ? (
                              <span className="block truncate text-[11px] text-faint">
                                conectado
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
                          onClick={() => handleInvite(f.pubkey, name)}
                          disabled={inviteDisabledFor(f.pubkey)}
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
                            onClick={() => handleInvite(g.pubkey, name)}
                            disabled={inviteDisabledFor(g.pubkey)}
                            className="mt-1.5 w-full rounded-sm border border-green/40 px-2.5 py-1 text-xs font-medium text-green hover:bg-green/10 disabled:opacity-50"
                          >
                            {inviteLabelFor(g.pubkey)}
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
