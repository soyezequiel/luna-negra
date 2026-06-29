"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSession } from "@/providers/session-provider";
import {
  fetchProfiles,
  profileName,
  type Profile,
} from "@/lib/nostr-social";
import type { NotifItem, NotificationsResponse } from "@/lib/notifications";

const MAX_ITEMS = 50;
const POLL_MS = 90_000;
const FOCUS_THROTTLE_MS = 60_000;
// Ventana para "Deshacer" un descarte antes de persistirlo.
const UNDO_MS = 5_000;

export type NotificationsCenterValue = {
  items: NotifItem[] | null;
  unreadCount: number;
  /** Marca "visto hasta" vigente (epoch ms) o null. Para resaltar lo no leído. */
  seenAt: number | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Marca todo como leído (avanza la marca "visto hasta" a ahora). */
  markAllSeen: () => void;
  /** Descarta una notificación: abre una ventana de "Deshacer" y luego persiste. */
  dismiss: (id: string) => void;
  /** Cancela un descarte mientras está en la ventana de "Deshacer". */
  undoDismiss: (id: string) => void;
  /** Ids en ventana de "Deshacer" (se muestran como tira "descartada · Deshacer"). */
  pendingDismissals: Set<string>;
};

/** Resuelve nombres legibles para los actores que solo traen npub (zaps/comentarios). */
async function resolveActorNames(items: NotifItem[]): Promise<NotifItem[]> {
  const needHex = new Map<string, string>(); // npub → hex
  for (const it of items) {
    if (!it.actorName && it.actorNpub) {
      try {
        const { nip19 } = await import("nostr-tools");
        const d = nip19.decode(it.actorNpub);
        if (d.type === "npub") needHex.set(it.actorNpub, d.data as string);
      } catch {
        /* npub inválido: se muestra recortado */
      }
    }
  }
  if (needHex.size === 0) return items;
  let profiles: Record<string, Profile> = {};
  try {
    profiles = await fetchProfiles([...needHex.values()]);
  } catch {
    /* sin red: caemos al npub recortado */
  }
  return items.map((it) => {
    if (it.actorName || !it.actorNpub) return it;
    const hex = needHex.get(it.actorNpub);
    const name = hex ? profileName(profiles[hex], "") : "";
    return name ? { ...it, actorName: name } : it;
  });
}

export function useNotificationsCenterData(): NotificationsCenterValue {
  const { user } = useSession();
  const [items, setItems] = useState<NotifItem[] | null>(null);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);
  const lastLoadRef = useRef(0);
  // Claves descartadas conocidas (server + descartes optimistas locales). Se usa
  // para filtrar el feed incluso antes de que el server confirme el POST.
  const dismissedRef = useRef<Set<string>>(new Set());
  // Descartes en ventana de "Deshacer": id → timer que lo persiste al expirar.
  const [pendingDismissals, setPendingDismissals] = useState<Set<string>>(
    new Set(),
  );
  const undoTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const load = useCallback(async () => {
    if (!user) {
      setItems(null);
      setSeenAt(null);
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    lastLoadRef.current = Date.now();
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as NotificationsResponse;
      setSeenAt(data.seenAt);

      // Unión de descartes del server con los locales (un descarte optimista no
      // debe reaparecer si el server todavía no lo registró).
      for (const k of data.dismissed) dismissedRef.current.add(k);
      const visible = data.items.filter(
        (it) => !dismissedRef.current.has(it.id),
      );

      // Pintamos ya; luego resolvemos los nombres de los actores (zaps/comentarios
      // solo traen npub) contra los perfiles kind:0 y re-renderizamos.
      setItems(visible.slice(0, MAX_ITEMS));
      const withNames = await resolveActorNames(visible.slice(0, MAX_ITEMS));
      setItems(withNames);
    } catch {
      /* best-effort: reintenta en el próximo poll/foco */
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    // Poll inicial + intervalo: suscripción a un sistema externo (uso legítimo).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    if (!user) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [user, load]);

  // Refresco al volver a la pestaña (throttle para no golpear en cada alt-tab).
  useEffect(() => {
    if (!user) return;
    const maybeReload = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadRef.current < FOCUS_THROTTLE_MS) return;
      void load();
    };
    window.addEventListener("focus", maybeReload);
    document.addEventListener("visibilitychange", maybeReload);
    return () => {
      window.removeEventListener("focus", maybeReload);
      document.removeEventListener("visibilitychange", maybeReload);
    };
  }, [user, load]);

  const markAllSeen = useCallback(() => {
    const newest = items && items.length > 0 ? items[0].at : Date.now();
    const at = Math.max(newest, Date.now());
    if (seenAt != null && seenAt >= at) return;
    setSeenAt(at); // optimista
    void fetch("/api/notifications/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ at }),
    }).catch(() => {
      /* si falla, el próximo load corrige la marca desde el server */
    });
  }, [items, seenAt]);

  // Persiste el descarte de verdad: lo saca del feed y lo manda al server.
  const finalizeDismiss = useCallback((id: string) => {
    undoTimers.current.delete(id);
    setPendingDismissals((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    dismissedRef.current.add(id);
    setItems((prev) => (prev ? prev.filter((it) => it.id !== id) : prev));
    void fetch("/api/notifications/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {
      /* si falla, reaparece en el próximo load (no se persistió) */
    });
  }, []);

  // Abre la ventana de "Deshacer": la fila queda en estado "descartada" pero el
  // ítem no se borra ni se persiste hasta que expira el timer.
  const dismiss = useCallback(
    (id: string) => {
      if (undoTimers.current.has(id)) return; // ya en ventana
      setPendingDismissals((prev) => new Set(prev).add(id));
      const t = setTimeout(() => finalizeDismiss(id), UNDO_MS);
      undoTimers.current.set(id, t);
    },
    [finalizeDismiss],
  );

  const undoDismiss = useCallback((id: string) => {
    const t = undoTimers.current.get(id);
    if (t) clearTimeout(t);
    undoTimers.current.delete(id);
    setPendingDismissals((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Al desmontar, persiste lo que quedó en ventana (no se pierde la intención).
  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      for (const [id, t] of timers) {
        clearTimeout(t);
        void fetch("/api/notifications/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }).catch(() => {});
      }
      timers.clear();
    };
  }, []);

  const unreadCount =
    items?.reduce((n, it) => (it.at > (seenAt ?? 0) ? n + 1 : n), 0) ?? 0;

  return {
    items,
    unreadCount,
    seenAt,
    refreshing,
    refresh: load,
    markAllSeen,
    dismiss,
    undoDismiss,
    pendingDismissals,
  };
}

const FALLBACK: NotificationsCenterValue = {
  items: null,
  unreadCount: 0,
  seenAt: null,
  refreshing: false,
  refresh: async () => {},
  markAllSeen: () => {},
  dismiss: () => {},
  undoDismiss: () => {},
  pendingDismissals: new Set(),
};

export const NotificationsCenterContext =
  createContext<NotificationsCenterValue | null>(null);

/** Lee el centro de notificaciones compartido (lo provee NotificationsCenterProvider). */
export function useNotificationsCenter(): NotificationsCenterValue {
  return useContext(NotificationsCenterContext) ?? FALLBACK;
}
