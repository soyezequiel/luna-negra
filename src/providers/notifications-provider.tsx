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
  shortId,
  type Profile,
} from "@/lib/nostr-social";
import { parseInvite, inviteHref } from "@/lib/invite";

type Toast = { id: number; title: string; body?: string; href?: string };

type NotificationsContextValue = {
  notify: (t: { title: string; body?: string; href?: string }) => void;
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
    ({ title, body, href }: { title: string; body?: string; href?: string }) => {
      const id = ++idSeq.current;
      setToasts((prev) => [...prev, { id, title, body, href }]);
      setTimeout(() => dismiss(id), TOAST_TTL);
    },
    [dismiss],
  );

  // Notificación nativa de Chrome (si hay permiso). Click → enfoca y navega.
  const fireDesktop = useCallback(
    (title: string, body: string, href?: string) => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      try {
        const n = new Notification(title, { body, icon: "/globe.svg" });
        n.onclick = () => {
          window.focus();
          if (href) router.push(href);
          n.close();
        };
      } catch {
        /* algunos navegadores exigen Service Worker; ignoramos */
      }
    },
    [router],
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
          const title = `🎮 ${name} te invitó a jugar`;
          const body = "Tocá para unirte a la sala";
          const href = inviteHref(invite);
          notify({ title, body, href });
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

  return (
    <NotificationsContext.Provider value={{ notify }}>
      {children}

      {/* Banner de permiso */}
      {showPermissionBanner ? (
        <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
          <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#11141a] px-4 py-3 text-sm shadow-lg">
            <span className="text-zinc-300">
              Activá las notificaciones para enterarte de invitaciones y mensajes.
            </span>
            <button
              onClick={requestPermission}
              className="shrink-0 rounded-md bg-sky-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            >
              Activar
            </button>
            <button
              onClick={() => setShowPermissionBanner(false)}
              className="shrink-0 rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Ahora no
            </button>
          </div>
        </div>
      ) : null}

      {/* Pila de toasts */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-xs flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-lg border border-white/10 bg-[#11141a] p-3 shadow-lg"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {t.title}
                </p>
                {t.body ? (
                  <p className="mt-0.5 text-xs text-zinc-400">{t.body}</p>
                ) : null}
                {t.href ? (
                  <button
                    onClick={() => {
                      router.push(t.href!);
                      dismiss(t.id);
                    }}
                    className="mt-2 rounded-md bg-sky-500/20 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/30"
                  >
                    {t.href.startsWith("/game/") ? "Unirse a la sala" : "Ver mensaje"}
                  </button>
                ) : null}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-zinc-500 hover:text-zinc-300"
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
