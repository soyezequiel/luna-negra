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
  fetchGameActivity,
  fetchProfiles,
  gameNoteText,
  npubOf,
  profileName,
  shortId,
  type Profile,
} from "@/lib/nostr-social";
import type { NotifItem, NotificationsResponse } from "@/lib/notifications";

// Máximo de juegos a los que les traemos comentarios Nostr por carga (cada uno
// es una consulta a relays; un dev con muchos juegos no debe disparar una
// tormenta). Los más nuevos primero (el server los devuelve por orden de juego).
const MAX_COMMENT_GAMES = 10;
const MAX_ITEMS = 50;
const POLL_MS = 90_000;
const FOCUS_THROTTLE_MS = 60_000;

export type NotificationsCenterValue = {
  items: NotifItem[] | null;
  unreadCount: number;
  /** Marca "visto hasta" vigente (epoch ms) o null. Para resaltar lo no leído. */
  seenAt: number | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Marca todo como leído (avanza la marca "visto hasta" a ahora). */
  markAllSeen: () => void;
};

/** Trae los comentarios kind:1 de los juegos del dev y los vuelve NotifItem. */
async function fetchCommentItems(
  games: NotificationsResponse["games"],
  myPubkey: string,
): Promise<NotifItem[]> {
  const subset = games.slice(0, MAX_COMMENT_GAMES);
  const perGame = await Promise.all(
    subset.map(async (g) => {
      try {
        const notes = await fetchGameActivity(g.slug, g.nostrEventId);
        return notes
          .filter((n) => n.pubkey !== myPubkey) // no me notifico de mis propios comentarios
          .map(
            (n): NotifItem => ({
              id: `comment:${n.id}`,
              type: "comment",
              at: n.created_at * 1000,
              gameSlug: g.slug,
              gameTitle: g.title,
              actorNpub: npubOf(n.pubkey),
              text: gameNoteText(n.content),
              href: `/game/${g.slug}`,
            }),
          );
      } catch {
        return [] as NotifItem[];
      }
    }),
  );
  return perGame.flat();
}

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

      // Pintamos los ítems de DB ya mismo; los comentarios Nostr llegan después.
      setItems(data.items.slice(0, MAX_ITEMS));

      const comments = await fetchCommentItems(data.games, user.pubkey);
      const merged = [...data.items, ...comments].sort((a, b) => b.at - a.at);
      const withNames = await resolveActorNames(merged.slice(0, MAX_ITEMS));
      setItems(withNames);
    } catch {
      /* best-effort: reintenta en el próximo poll/foco */
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
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

  const unreadCount =
    items?.reduce((n, it) => (it.at > (seenAt ?? 0) ? n + 1 : n), 0) ?? 0;

  return { items, unreadCount, seenAt, refreshing, refresh: load, markAllSeen };
}

const FALLBACK: NotificationsCenterValue = {
  items: null,
  unreadCount: 0,
  seenAt: null,
  refreshing: false,
  refresh: async () => {},
  markAllSeen: () => {},
};

export const NotificationsCenterContext =
  createContext<NotificationsCenterValue | null>(null);

/** Lee el centro de notificaciones compartido (lo provee NotificationsCenterProvider). */
export function useNotificationsCenter(): NotificationsCenterValue {
  return useContext(NotificationsCenterContext) ?? FALLBACK;
}
