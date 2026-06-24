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
  clampContacts,
  fetchContacts,
  fetchProfiles,
  fetchStatuses,
  npubOf,
  profileName,
  type Profile,
  type Status,
} from "@/lib/nostr-social";
import { compareFriends } from "@/lib/friend-sort";

export type Friend = {
  pubkey: string;
  npub: string;
  profile?: Profile;
  isMember: boolean;
  games: { slug: string; title: string }[];
  status?: Status;
  /** Última vez que jugó en Luna Negra (epoch ms) o null si nunca. */
  lastPlayedAt: number | null;
};

type Known = {
  pubkey: string;
  npub: string;
  displayName: string | null;
  games: { slug: string; title: string }[];
  lastPlayedAt: number | null;
};

// --- Caché local (stale-while-revalidate): mostrar amigos al instante al
// volver, mientras se refresca en segundo plano desde los relays. ---
const cacheKey = (pubkey: string) => `friends:${pubkey}`;

function readCache(pubkey: string): Friend[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey));
    if (!raw) return null;
    const cached = JSON.parse(raw) as Friend[];
    return Array.isArray(cached) ? stripVolatileStatuses(cached) : null;
  } catch {
    return null;
  }
}

function writeCache(pubkey: string, friends: Friend[]) {
  try {
    localStorage.setItem(
      cacheKey(pubkey),
      JSON.stringify(stripVolatileStatuses(friends)),
    );
  } catch {
    /* cuota llena o storage no disponible: ignorar */
  }
}

export function stripVolatileStatuses(friends: Friend[]): Friend[] {
  return friends.map((friend) => {
    const cached = { ...friend };
    delete cached.status;
    return cached;
  });
}

export function applyFreshStatuses(
  friends: Friend[],
  statuses: Partial<Record<string, Status>>,
): Friend[] {
  return friends.map((friend) => ({
    ...friend,
    status: statuses[friend.pubkey],
  }));
}

function sortFriends(list: Friend[]): Friend[] {
  return [...list].sort((a, b) =>
    compareFriends(
      {
        name: profileName(a.profile, a.npub),
        playingNow: Boolean(a.status),
        lastPlayedAt: a.lastPlayedAt,
        isMember: a.isMember,
      },
      {
        name: profileName(b.profile, b.npub),
        playingNow: Boolean(b.status),
        lastPlayedAt: b.lastPlayedAt,
        isMember: b.isMember,
      },
    ),
  );
}

export type FriendsValue = {
  friends: Friend[] | null;
  refresh: () => Promise<void>;
  refreshing: boolean;
};

/**
 * Carga la lista de amigos (contactos Nostr del usuario) enriquecida con perfil,
 * estado NIP-38, si son miembros de Luna Negra y sus juegos. Usa caché local
 * para pintar al instante y refresca desde los relays en segundo plano.
 * `refresh` re-consulta a demanda (botón ↻); además se refresca solo al volver
 * el foco a la pestaña (throttle de 60s).
 *
 * IMPORTANTE: este hook dispara una tormenta de consultas a relays (contactos +
 * ~150 perfiles + estados + /api/users/known). Por eso NO se usa directo en cada
 * componente: lo corre UNA sola vez `FriendsProvider` y el resto lo consume vía
 * `useFriends()`. Llamarlo en dos componentes a la vez (p. ej. la barra lateral
 * y el riel del home) duplicaba toda la descarga y saturaba el navegador.
 */
export function useFriendsData(): FriendsValue {
  const { user } = useSession();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);
  const lastLoadRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) {
      setFriends(null);
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    lastLoadRef.current = Date.now();
    try {
      // 1) Caché: pintar al instante lo último que vimos (se refresca abajo).
      const cached = readCache(user.pubkey);
      if (cached && cached.length > 0) setFriends(cached);

      // 2) Contactos: apenas llegan, mostramos la lista (nombre/avatar se
      //    completan después). Conservamos datos enriquecidos del caché por pk.
      //    Limitamos a 150 para no saturar los relays con filtros gigantes.
      const rawContacts = await fetchContacts(user.pubkey);
      if (rawContacts.length === 0) {
        setFriends([]);
        writeCache(user.pubkey, []);
        return;
      }
      const contacts = clampContacts(rawContacts);

      const cachedByPk = new Map((cached ?? []).map((f) => [f.pubkey, f]));
      let list: Friend[] = contacts.map((pk) => {
        const prev = cachedByPk.get(pk);
        return {
          pubkey: pk,
          npub: npubOf(pk),
          profile: prev?.profile,
          isMember: prev?.isMember ?? false,
          games: prev?.games ?? [],
          lastPlayedAt: prev?.lastPlayedAt ?? null,
        };
      });
      list = sortFriends(list);
      setFriends(list);

      // 3) Enriquecer en paralelo y mergear cada resultado en cuanto resuelve,
      //    sin esperar a que terminen las tres consultas.
      const merge = (patch: (f: Friend) => Friend) => {
        list = sortFriends(list.map(patch));
        setFriends(list);
        writeCache(user.pubkey, list);
      };

      const pProfiles = fetchProfiles(contacts).then((profiles) =>
        merge((f) => ({ ...f, profile: profiles[f.pubkey] ?? f.profile })),
      );
      const pStatuses = fetchStatuses(contacts).then((statuses) => {
        list = sortFriends(applyFreshStatuses(list, statuses));
        setFriends(list);
        writeCache(user.pubkey, list);
      });
      const pKnown = fetch("/api/users/known", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkeys: contacts }),
      })
        .then((r) => r.json())
        .catch(() => ({ known: [] }))
        .then((knownRes) => {
          const knownMap = new Map<string, Known>(
            (knownRes.known ?? []).map((k: Known) => [k.pubkey, k]),
          );
          merge((f) => {
            const k = knownMap.get(f.pubkey);
            return {
              ...f,
              isMember: Boolean(k),
              games: k?.games ?? [],
              lastPlayedAt: k?.lastPlayedAt ?? null,
            };
          });
        });

      await Promise.allSettled([pProfiles, pStatuses, pKnown]);
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Refresco al volver a la pestaña (p. ej. después de seguir a alguien en otro
  // cliente), con throttle para no golpear los relays en cada alt-tab.
  useEffect(() => {
    const maybeReload = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadRef.current < 60_000) return;
      void load();
    };
    window.addEventListener("focus", maybeReload);
    document.addEventListener("visibilitychange", maybeReload);
    return () => {
      window.removeEventListener("focus", maybeReload);
      document.removeEventListener("visibilitychange", maybeReload);
    };
  }, [load]);

  return { friends, refresh: load, refreshing };
}

// Estado compartido: lo provee `FriendsProvider` (montado una vez en el layout)
// y lo consumen todos los componentes vía `useFriends()`. Sin esto, cada
// consumidor disparaba su propia carga de relays en paralelo.
const FRIENDS_FALLBACK: FriendsValue = {
  friends: null,
  refresh: async () => {},
  refreshing: false,
};

export const FriendsContext = createContext<FriendsValue | null>(null);

/**
 * Lee la lista de amigos compartida. Devuelve el mismo objeto para todos los
 * consumidores: la descarga desde los relays ocurre una sola vez en
 * `FriendsProvider`. Fuera del provider cae a un valor vacío (no rompe el render
 * ni dispara consultas).
 */
export function useFriends(): FriendsValue {
  return useContext(FriendsContext) ?? FRIENDS_FALLBACK;
}
