"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
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
  type Profile,
} from "@/lib/nostr-social";
import {
  parseInvite,
  parseInviteTitle,
  inviteHref,
  addPendingInvite,
} from "@/lib/invite";
import { joinRoomAndPlay } from "@/lib/room-launch";

type ToastKind = "info" | "play" | "join" | "btc" | "warn";
type Toast = {
  id: number;
  title: string;
  body?: string;
  href?: string;
  kind: ToastKind;
};

type NotificationsContextValue = {
  notify: (t: {
    title: string;
    body?: string;
    href?: string;
    kind?: ToastKind;
  }) => void;
};

// Punto de color + halo por tipo de toast (ver design-spec §Toasts).
const TOAST_DOT: Record<ToastKind, string> = {
  info: "var(--blue)",
  join: "var(--blue)",
  play: "var(--green)",
  btc: "var(--btc)",
  warn: "var(--lose)",
};

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null,
);

const TOAST_TTL = 6000;
const DECRYPT_FAIL = "[no se pudo descifrar]";

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useSession();
  const router = useRouter();

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showPermissionBanner, setShowPermissionBanner] = useState(false);

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
    }: {
      title: string;
      body?: string;
      href?: string;
      kind?: ToastKind;
    }) => {
      const id = ++idSeq.current;
      setToasts((prev) => [...prev, { id, title, body, href, kind }]);
      setTimeout(() => dismiss(id), TOAST_TTL);
    },
    [dismiss],
  );

  // Abre el destino de una notificación. Si es una invitación a sala, reutiliza
  // la pestaña del juego abierta por Luna Negra; si no existe, abre una nueva.
  const openHref = useCallback(
    (href: string) => {
      const invite = parseInvite(href);
      if (invite) {
        void joinRoomAndPlay({
          slug: invite.slug,
          roomId: invite.roomId,
          onError: (body) => notify({ title: "No se pudo unir a la sala", body: body ?? undefined }),
        });
      } else if (/^https?:\/\//.test(href)) {
        window.open(href, "_blank", "noopener");
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

  // Banner para pedir permiso de notificaciones (requiere gesto del usuario).
  useEffect(() => {
    if (!user) {
      setShowPermissionBanner(false);
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      setShowPermissionBanner(true);
    }
  }, [user]);

  const requestPermission = useCallback(async () => {
    setShowPermissionBanner(false);
    try {
      await Notification.requestPermission();
    } catch {
      /* no-op */
    }
  }, []);

  // Resuelve el nombre del emisor (caché en memoria), con fallback al npub corto.
  const nameOf = useCallback(async (pubkey: string): Promise<string> => {
    const fallback = shortId(npubOf(pubkey));
    if (!profileCache.current.has(pubkey)) {
      try {
        const map = await fetchProfiles([pubkey]);
        profileCache.current.set(pubkey, map[pubkey]);
      } catch {
        profileCache.current.set(pubkey, undefined);
      }
    }
    return profileName(profileCache.current.get(pubkey), fallback);
  }, []);

  // Escucha de DMs entrantes mientras hay sesión.
  useEffect(() => {
    if (!user) return;
    const myPubkey = user.pubkey;
    const sub = subscribeDms(myPubkey, (ev) => {
      if (ev.pubkey === myPubkey) return; // propio
      if (seen.current.has(ev.id)) return; // dedup multi-relay
      seen.current.add(ev.id);
      void handleIncoming(ev);
    });

    async function handleIncoming(ev: Parameters<typeof decryptDm>[0]) {
      const senderPubkey = ev.pubkey;
      const name = await nameOf(senderPubkey);
      const npub = npubOf(senderPubkey);

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
          // Persistimos la invitación para que quede anclada en la barra de
          // amigos (no solo como toast efímero).
          addPendingInvite({
            ...invite,
            fromPubkey: senderPubkey,
            title: parseInviteTitle(plain) ?? invite.slug,
            at: Date.now(),
          });
          const title = `🎮 ${name} te invitó a jugar`;
          const body = "Tocá para unirte a la sala";
          const href = inviteHref(invite);
          notify({ title, body, href, kind: "join" });
          fireDesktop(title, body, href);
          return;
        }
      }

      const title = `Nuevo mensaje de ${name}`;
      const href = `/messages?to=${npub}`;
      notify({ title, href });
      fireDesktop(title, "Tenés un mensaje nuevo en Luna Negra", href);
    }

    return () => sub.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, notify, fireDesktop, nameOf]);

  // Polling del buzón de invitaciones a sala que envían los proveedores de juegos
  // (POST /api/v1/friends/invite → persistidas; acá las mostramos como toast). La
  // `inviteUrl` es del deploy externo del juego, así que se abre en pestaña nueva.
  useEffect(() => {
    if (!user) return;
    let stopped = false;

    type GameInvite = {
      id: string;
      fromNpub: string;
      roomId: string;
      inviteUrl: string;
    };

    async function poll() {
      try {
        const r = await fetch("/api/invites");
        if (!r.ok) return;
        const d = (await r.json()) as { invites?: GameInvite[] };
        for (const inv of d.invites ?? []) {
          if (seen.current.has(inv.id)) continue; // dedup (cuid ≠ id de evento DM)
          seen.current.add(inv.id);
          const fromPubkey = pubkeyFromNpub(inv.fromNpub);
          const name = fromPubkey ? await nameOf(fromPubkey) : shortId(inv.fromNpub);
          const title = `🎮 ${name} te invitó a una sala`;
          const body = "Tocá para unirte";
          notify({ title, body, href: inv.inviteUrl, kind: "join" });
          fireDesktop(title, body, inv.inviteUrl);
        }
      } catch {
        /* best-effort: sin red, reintenta en el próximo tick */
      }
    }

    void poll();
    const id = setInterval(() => {
      if (!stopped) void poll();
    }, 15_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, notify, fireDesktop, nameOf]);

  return (
    <NotificationsContext.Provider value={{ notify }}>
      {children}

      {/* Banner de permiso */}
      {showPermissionBanner ? (
        <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
          <div className="flex items-center gap-3 rounded-lg border border-line-2 bg-panel-2 px-4 py-3 text-sm shadow-[0_18px_40px_-22px_rgba(0,0,0,.85)]">
            <span className="text-ink">
              Activá las notificaciones para enterarte de invitaciones y mensajes.
            </span>
            <button
              onClick={requestPermission}
              className="btn btn-blue shrink-0 px-3 py-1.5 text-xs"
            >
              Activar
            </button>
            <button
              onClick={() => setShowPermissionBanner(false)}
              className="shrink-0 rounded-sm px-2 py-1.5 text-xs text-muted hover:text-ink"
            >
              Ahora no
            </button>
          </div>
        </div>
      ) : null}

      {/* Pila de toasts (abajo-derecha, entrada deslizante) */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-xs flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in pointer-events-auto rounded-lg border border-line-2 p-3 shadow-[0_18px_40px_-18px_rgba(0,0,0,.9)]"
            style={{ background: "linear-gradient(180deg,#1a2433,#121a25)" }}
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
                <p className="truncate text-sm font-semibold text-ink">
                  {t.title}
                </p>
                {t.body ? (
                  <p className="mt-0.5 text-xs text-muted">{t.body}</p>
                ) : null}
                {t.href ? (
                  <button
                    onClick={() => {
                      openHref(t.href!);
                      dismiss(t.id);
                    }}
                    className="mt-2 rounded-sm bg-blue/10 px-2.5 py-1 text-xs font-semibold text-blue hover:bg-white/10"
                  >
                    {t.href.startsWith("/game/") || /^https?:\/\//.test(t.href)
                      ? "Unirse a la sala"
                      : "Ver mensaje"}
                  </button>
                ) : null}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-faint hover:text-ink"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
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
