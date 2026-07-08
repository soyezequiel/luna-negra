"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import {
  subscribeDms,
  decryptDm,
  fetchProfiles,
  profileName,
  npubOf,
  pubkeyFromNpub,
  shortId,
  challengeUrlFromEvent,
  type Profile,
} from "@/lib/nostr-social";
import {
  parseInvite,
  parseRoomLink,
  parseInviteTitle,
  inviteHref,
  addPendingInvite,
  wasNotified,
  markNotified,
} from "@/lib/invite";
import {
  joinRoomAndPlay,
  openExternalGameLink,
  POPUP_BLOCKED_BODY,
  POPUP_BLOCKED_TITLE,
} from "@/lib/room-launch";
import { playInviteSound, armInviteSound } from "@/lib/notify-sound";
import { Avatar } from "@/components/ui/avatar";

type ToastKind = "info" | "play" | "join" | "btc" | "warn";
type Toast = {
  id: number;
  title: string;
  body?: string;
  href?: string;
  kind: ToastKind;
  actionLabel?: string;
  // Invitación estilo Steam: si vienen estos campos, el toast se renderiza como
  // una tarjeta grande con la foto de quien invita y el nombre del juego.
  invite?: {
    /** Nombre de quien invita (para el título y el color del placeholder). */
    fromName: string;
    /** Foto de perfil de quien invita (puede faltar → placeholder). */
    fromPicture?: string;
    /** Nombre del juego al que invita. */
    game: string;
  };
};

// Invitación a sala del buzón first-party (GET /api/invites[/stream]).
type GameInvite = {
  id: string;
  fromNpub: string;
  roomId: string;
  inviteUrl: string;
  game?: string;
};

type NotifyOptions = {
  title: string;
  body?: string;
  href?: string;
  kind?: ToastKind;
  actionLabel?: string;
  invite?: Toast["invite"];
  /** Reproduce el chime de invitación al aparecer. */
  sound?: boolean;
};

type NotificationsContextValue = {
  notify: (t: NotifyOptions) => void;
};

// Punto de color + halo por tipo de toast (ver design-spec §Toasts).
const TOAST_DOT: Record<ToastKind, string> = {
  info: "var(--ln-luna)",
  join: "var(--ln-luna)",
  play: "var(--ln-aurora)",
  btc: "var(--ln-corona)",
  warn: "var(--ln-danger)",
};

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null,
);

const TOAST_TTL = 6000;
// Las invitaciones a jugar viven más (como en Steam): dan tiempo a decidir.
const INVITE_TTL = 20000;
const DECRYPT_FAIL = "[no se pudo descifrar]";
// La sub de DMs mira esta ventana hacia atrás (además del presente) para pescar
// invitaciones recibidas con Luna Negra cerrada y mostrarlas al abrir la página.
// Coincide con la vigencia de las invitaciones (1h): las más viejas ya expiraron.
const INVITE_LOOKBACK_SEC = 3600;

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useSession();
  const router = useRouter();

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showPermissionBanner, setShowPermissionBanner] = useState(false);
  const [, startPermissionTransition] = useTransition();

  const seen = useRef<Set<string>>(new Set());
  const profileCache = useRef<Map<string, Profile | undefined>>(new Map());
  const idSeq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    ({
      title,
      body,
      href,
      kind = "info",
      actionLabel,
      invite,
      sound,
    }: NotifyOptions) => {
      const id = ++idSeq.current;
      setToasts((prev) => [
        ...prev,
        { id, title, body, href, kind, actionLabel, invite },
      ]);
      if (sound) playInviteSound();
      setTimeout(() => dismiss(id), invite ? INVITE_TTL : TOAST_TTL);
    },
    [dismiss],
  );

  // Abre el destino de una notificación. Si es una invitación a sala, reutiliza
  // la pestaña del juego abierta por Luna Negra; si no existe, abre una nueva.
  // Si el navegador bloquea la ventana (Brave Shields), se avisa con un toast
  // cuyo click —un gesto nuevo— reintenta, con fallback a la misma pestaña.
  const openHref = useCallback(
    (href: string) => {
      const invite = parseInvite(href);
      if (invite) {
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
      } else if (/^https?:\/\//.test(href)) {
        // Room-link externo: abrir en pestaña nueva sin reemplazar Luna. Si el
        // navegador bloquea el popup, avisar con un toast (nuevo gesto reintenta)
        // en vez de navegar la pestaña actual.
        if (!openExternalGameLink(href)) {
          notify({
            title: POPUP_BLOCKED_TITLE,
            body: POPUP_BLOCKED_BODY,
            href,
            kind: "warn",
            actionLabel: "Abrir juego",
          });
        }
      } else {
        router.push(href);
      }
    },
    [router, notify],
  );

  // Notificación nativa de Chrome (si hay permiso). Click → enfoca y abre.
  const fireDesktop = useCallback(
    (title: string, body: string, href?: string) => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      try {
        const n = new Notification(title, { body, icon: "/globe.svg" });
        n.onclick = () => {
          window.focus();
          if (href) openHref(href);
          n.close();
        };
      } catch {
        /* algunos navegadores exigen Service Worker; ignoramos */
      }
    },
    [openHref],
  );

  // Ceba el audio en el primer gesto del usuario para que el chime de invitación
  // pueda sonar cuando llegue por SSE/DM (sin esto el navegador lo bloquea).
  useEffect(() => {
    armInviteSound();
  }, []);

  // Banner para pedir permiso de notificaciones (requiere gesto del usuario).
  useEffect(() => {
    if (!user) {
      startPermissionTransition(() => {
        setShowPermissionBanner(false);
      });
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      startPermissionTransition(() => {
        setShowPermissionBanner(true);
      });
    }
  }, [user, startPermissionTransition]);

  const requestPermission = useCallback(async () => {
    setShowPermissionBanner(false);
    try {
      await Notification.requestPermission();
    } catch {
      /* no-op */
    }
  }, []);

  // Resuelve el perfil del emisor (caché en memoria): nombre para el título y
  // foto para el avatar de la invitación. Cae al npub corto si no hay perfil.
  const profileOf = useCallback(
    async (pubkey: string): Promise<{ name: string; picture?: string }> => {
      const fallback = shortId(npubOf(pubkey));
      if (!profileCache.current.has(pubkey)) {
        try {
          const map = await fetchProfiles([pubkey]);
          profileCache.current.set(pubkey, map[pubkey]);
        } catch {
          profileCache.current.set(pubkey, undefined);
        }
      }
      const p = profileCache.current.get(pubkey);
      return { name: profileName(p, fallback), picture: p?.picture };
    },
    [],
  );

  // Escucha de DMs entrantes mientras hay sesión.
  useEffect(() => {
    if (!user) return;
    const myPubkey = user.pubkey;
    // La sub mira una ventana hacia atrás (INVITE_LOOKBACK_SEC) además del
    // presente: así una invitación recibida con Luna Negra cerrada aparece al
    // abrir la página. Guardamos el arranque de la sesión para distinguir lo "en
    // vivo" (recién llegado) de lo histórico (recibido offline).
    const sessionStart = Math.floor(Date.now() / 1000);
    const sub = subscribeDms(
      myPubkey,
      (ev) => {
        if (ev.pubkey === myPubkey) return; // propio
        if (seen.current.has(ev.id)) return; // dedup multi-relay (en memoria)
        seen.current.add(ev.id);
        void handleIncoming(ev, sessionStart);
      },
      sessionStart - INVITE_LOOKBACK_SEC,
    );

    async function handleIncoming(
      ev: Parameters<typeof decryptDm>[0],
      sessionStart: number,
    ) {
      // Ya avisado antes (otra pestaña o una carga previa): no repetir el toast.
      // Sin esto, la ventana de lookback re-dispararía en cada recarga la misma
      // invitación —incluso una ya descartada— porque volvería a entrar por la sub.
      if (wasNotified(ev.id)) return;
      // Histórico = recibido con Luna cerrada (antes de abrir esta sesión). Los
      // mensajes de chat viejos no se re-notifican al abrir (evita un aluvión de
      // toasts del backlog); las invitaciones sí, que es lo que queremos rescatar.
      const live = ev.created_at >= sessionStart;

      const senderPubkey = ev.pubkey;
      const { name, picture } = await profileOf(senderPubkey);
      const npub = npubOf(senderPubkey);

      // Reto NIP-17 (rumor kind:14 con tag `url`): toast accionable que abre el
      // juego en la sala del reto, sin pasar por el chat.
      const challengeUrl = challengeUrlFromEvent(ev);
      if (challengeUrl) {
        markNotified(ev.id);
        // Anclamos también en la barra de amigos si el enlace lleva sala, para que
        // el reto no se pierda si se pasa el toast.
        const chInvite = parseInvite(challengeUrl);
        const chLink = chInvite ? null : parseRoomLink(challengeUrl);
        if (chInvite || chLink) {
          addPendingInvite({
            fromPubkey: senderPubkey,
            title: "una partida",
            at: Date.now(),
            roomId: chInvite?.roomId ?? chLink!.roomId,
            ...(chInvite ? { slug: chInvite.slug } : { url: chLink!.url }),
          });
        }
        const title = `${name} te retó a jugar`;
        const body = "Tocá para unirte a la partida";
        notify({
          title,
          body,
          href: challengeUrl,
          kind: "join",
          invite: { fromName: name, fromPicture: picture, game: "una partida" },
          sound: true,
        });
        fireDesktop(`🎮 ${title}`, body, challengeUrl);
        return;
      }

      // Intentar descifrar para detectar invitación; si falla, DM genérico.
      let plain = "";
      try {
        plain = await decryptDm(ev, myPubkey);
      } catch {
        plain = "";
      }

      if (plain && plain !== DECRYPT_FAIL) {
        const invite = parseInvite(plain);
        if (invite) {
          markNotified(ev.id);
          // Persistimos la invitación para que quede anclada en la barra de
          // amigos (no solo como toast efímero).
          const game = parseInviteTitle(plain) ?? invite.slug;
          addPendingInvite({
            ...invite,
            fromPubkey: senderPubkey,
            title: game,
            at: Date.now(),
          });
          const title = `${name} te invitó a jugar`;
          const body = "Tocá para unirte a la sala";
          const href = inviteHref(invite);
          notify({
            title,
            body,
            href,
            kind: "join",
            invite: { fromName: name, fromPicture: picture, game },
            sound: true,
          });
          fireDesktop(`🎮 ${title}`, body, href);
          return;
        }
        // "Luna Room Link": DM con un enlace `?lnRoom=` del dominio del juego. Se
        // ancla igual que una invitación de Luna, pero unirse = abrir esa URL.
        const roomLink = parseRoomLink(plain);
        if (roomLink) {
          markNotified(ev.id);
          const game = parseInviteTitle(plain) ?? "una sala";
          addPendingInvite({
            roomId: roomLink.roomId,
            url: roomLink.url,
            fromPubkey: senderPubkey,
            title: game,
            at: Date.now(),
          });
          const title = `${name} te invitó a jugar`;
          const body = "Tocá para unirte a la sala";
          notify({
            title,
            body,
            href: roomLink.url,
            kind: "join",
            invite: { fromName: name, fromPicture: picture, game },
            sound: true,
          });
          fireDesktop(`🎮 ${title}`, body, roomLink.url);
          return;
        }
      }

      // DM genérico (no invitación): solo se notifica en vivo. Un mensaje recibido
      // con Luna cerrada no dispara toast al abrir (sí aparece en el chat).
      if (!live) return;
      markNotified(ev.id);
      const title = `Nuevo mensaje de ${name}`;
      const href = `/messages?to=${npub}`;
      notify({ title, href });
      fireDesktop(title, "Tenés un mensaje nuevo en Luna Negra", href);
    }

    return () => sub.close();
  }, [user, notify, fireDesktop, profileOf]);

  // Muestra como toast una invitación a sala recibida del buzón first-party
  // (POST /api/invites / /api/v1/invites → persistidas). La `inviteUrl` puede
  // ser del deploy externo del juego, así que se abre en pestaña nueva.
  const handleGameInvite = useCallback(
    async (inv: GameInvite) => {
      if (!inv.id || seen.current.has(inv.id)) return; // dedup (cuid ≠ id de DM)
      seen.current.add(inv.id);
      const fromPubkey = pubkeyFromNpub(inv.fromNpub);
      const { name, picture } = fromPubkey
        ? await profileOf(fromPubkey)
        : { name: shortId(inv.fromNpub), picture: undefined };
      const game = inv.game ?? "una sala";
      // Anclamos la invitación en la barra de amigos (además del toast efímero),
      // igual que las invitaciones por DM. Así sobrevive si el usuario no llegó a
      // ver el toast al cargar la página: el buzón (SSE) la entrega una sola vez y
      // la marca vista, pero acá queda persistida en localStorage (TTL 1h). El
      // inviteUrl first-party (`/game/<slug>?room=`) trae el slug; si es una URL
      // externa del juego, guardamos la URL cruda (unirse = abrirla).
      if (fromPubkey) {
        const firstParty = parseInvite(inv.inviteUrl);
        addPendingInvite({
          fromPubkey,
          title: game,
          at: Date.now(),
          roomId: inv.roomId,
          ...(firstParty ? { slug: firstParty.slug } : { url: inv.inviteUrl }),
        });
      }
      const title = `${name} te invitó a jugar`;
      const body = "Tocá para unirte";
      notify({
        title,
        body,
        href: inv.inviteUrl,
        kind: "join",
        invite: { fromName: name, fromPicture: picture, game },
        sound: true,
      });
      fireDesktop(`🎮 ${title}`, body, inv.inviteUrl);
    },
    [notify, fireDesktop, profileOf],
  );

  // Recepción de invitaciones a sala en tiempo real vía SSE (una sola conexión,
  // ~1-2s de latencia; EventSource reconecta solo). Si el navegador no soporta
  // EventSource, caemos a un polling lento de respaldo contra GET /api/invites.
  useEffect(() => {
    if (!user) return;

    if (typeof EventSource === "undefined") {
      let stopped = false;
      const poll = async () => {
        try {
          const r = await fetch("/api/invites");
          if (!r.ok) return;
          const d = (await r.json()) as { invites?: GameInvite[] };
          for (const inv of d.invites ?? []) await handleGameInvite(inv);
        } catch {
          /* best-effort: sin red, reintenta en el próximo tick */
        }
      };
      void poll();
      const id = setInterval(() => {
        if (!stopped) void poll();
      }, 15_000);
      return () => {
        stopped = true;
        clearInterval(id);
      };
    }

    // Diferimos abrir el stream hasta que la página termine de cargar y el hilo
    // quede ocioso. Una conexión SSE abierta durante la carga inicial mantiene
    // girando el indicador de carga del navegador (el "favicon cargando" que
    // notó la usuaria), aunque la página ya esté usable. Las invitaciones no son
    // urgentes al milisegundo, así que esperar al idle no se nota.
    let es: EventSource | null = null;
    let cancelled = false;
    let cancelSchedule: (() => void) | null = null;

    const open = () => {
      if (cancelled) return;
      es = new EventSource("/api/invites/stream");
      es.onmessage = (e) => {
        try {
          void handleGameInvite(JSON.parse(e.data) as GameInvite);
        } catch {
          /* heartbeat / línea no-JSON: ignorar */
        }
      };
      // No cerramos en onerror: EventSource reintenta solo (p. ej. cuando la
      // función serverless llega a su límite de duración y corta el stream).
    };

    const schedule = () => {
      if (cancelled) return;
      if (typeof requestIdleCallback === "function") {
        const id = requestIdleCallback(open, { timeout: 3000 });
        cancelSchedule = () => cancelIdleCallback(id);
      } else {
        const id = window.setTimeout(open, 1200);
        cancelSchedule = () => clearTimeout(id);
      }
    };

    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", schedule);
      cancelSchedule?.();
      es?.close();
    };
  }, [user, handleGameInvite]);

  return (
    <NotificationsContext.Provider value={{ notify }}>
      {children}

      {/* Banner de permiso (sobre la tab bar en móvil) */}
      {showPermissionBanner ? (
        <div className="fixed inset-x-0 bottom-[88px] z-50 flex justify-center px-4 ln:bottom-4">
          <div className="flex items-center gap-3 rounded-ln-lg border border-ln-border-strong bg-ln-card px-4 py-3 text-sm shadow-ln-modal">
            <span className="text-ln-text">
              Activá las notificaciones para enterarte de invitaciones y mensajes.
            </span>
            <button
              onClick={requestPermission}
              className="btn btn-luna shrink-0 px-3 py-1.5 text-xs"
            >
              Activar
            </button>
            <button
              onClick={() => setShowPermissionBanner(false)}
              className="shrink-0 rounded-full px-2 py-1.5 text-xs text-ln-muted hover:text-ln-text"
            >
              Ahora no
            </button>
          </div>
        </div>
      ) : null}

      {/* Pila de toasts: full-width sobre la tab bar en móvil; abajo-derecha en desktop. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[88px] z-50 flex flex-col gap-2 ln:inset-x-auto ln:bottom-4 ln:right-4 ln:w-full ln:max-w-xs">
        {toasts.map((t) =>
          t.invite ? (
            // Invitación estilo Steam: tarjeta grande con la foto de quien invita,
            // el nombre del juego y un botón "Unirse" que abre la sala.
            <div
              key={t.id}
              className="toast-in pointer-events-auto overflow-hidden rounded-ln-lg border border-ln-border-strong bg-ln-card shadow-ln-modal"
            >
              <div className="flex items-center gap-3 p-3">
                <Avatar
                  src={t.invite.fromPicture}
                  seed={t.invite.fromName}
                  className="h-11 w-11 shrink-0 ring-2 ring-ln-luna/40"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ln-muted">
                    <span className="font-semibold text-ln-text">
                      {t.invite.fromName}
                    </span>{" "}
                    te invitó a jugar
                  </p>
                  <p className="truncate text-base font-semibold text-ln-luna">
                    {t.invite.game}
                  </p>
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 self-start text-ln-faint hover:text-ln-text"
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>
              {t.href ? (
                <button
                  onClick={() => {
                    openHref(t.href!);
                    dismiss(t.id);
                  }}
                  className="btn btn-luna w-full rounded-none py-2.5 text-sm font-semibold"
                >
                  {t.actionLabel ?? "Unirse"}
                </button>
              ) : null}
            </div>
          ) : (
            <div
              key={t.id}
              className="toast-in pointer-events-auto rounded-ln-lg border border-ln-border-strong bg-ln-card p-3 shadow-ln-modal"
            >
              <div className="flex items-start gap-2.5">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: TOAST_DOT[t.kind],
                    boxShadow: `0 0 10px 1px ${TOAST_DOT[t.kind]}`,
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ln-text">
                    {t.title}
                  </p>
                  {t.body ? (
                    <p className="mt-0.5 text-xs text-ln-muted">{t.body}</p>
                  ) : null}
                  {t.href ? (
                    <button
                      onClick={() => {
                        openHref(t.href!);
                        dismiss(t.id);
                      }}
                      className="mt-2 rounded-full bg-ln-luna/15 px-2.5 py-1 text-xs font-semibold text-ln-luna hover:bg-ln-luna/25"
                    >
                      {t.actionLabel ??
                        (t.href.startsWith("/game/") ||
                        /^https?:\/\//.test(t.href)
                          ? "Unirse a la sala"
                          : "Ver mensaje")}
                    </button>
                  ) : null}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 text-ln-faint hover:text-ln-text"
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </NotificationsContext.Provider>
  );
}

export function useNotify(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx)
    throw new Error("useNotify debe usarse dentro de <NotificationsProvider>");
  return ctx;
}
