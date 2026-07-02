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
  /**
   * El servidor lo ve activo ahora (respuesta de /api/users/online): tiene la web
   * abierta (`StorePresence`) o está jugando algún juego detectado por la API
   * (`GamePresence`, sobrevive con la tienda cerrada). Efímero como `status`: no se
   * persiste en el caché de localStorage. "Conectado" = status (jugando vía NIP-38)
   * o esto.
   */
  onlineInStore?: boolean;
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

// Cadencia del poll de estados NIP-38. El juego re-publica su presencia cada
// ~120s (TTL 240s), así que 30s da una detección de ~medio minuto en el peor
// caso sin castigar los relays (una query por tick, sólo si la pestaña está
// visible y hay contactos cargados).
const STATUS_POLL_MS = 30_000;

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
    delete cached.onlineInStore;
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

/** Marca `onlineInStore` según el set de pubkeys con la tienda abierta ahora. */
export function applyOnlineInStore(
  friends: Friend[],
  online: Set<string>,
): Friend[] {
  return friends.map((friend) => ({
    ...friend,
    onlineInStore: online.has(friend.pubkey),
  }));
}

/** Consulta a /api/users/online: de los contactos, cuáles tienen la web abierta. */
async function fetchOnlineInStore(contacts: string[]): Promise<Set<string>> {
  try {
    const res = await fetch("/api/users/online", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkeys: contacts }),
    });
    const data = await res.json();
    return new Set<string>(Array.isArray(data.online) ? data.online : []);
  } catch {
    return new Set<string>();
  }
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
  // Contactos de la última carga completa, para el poll liviano de estados.
  const contactsRef = useRef<string[]>([]);

  const load = useCallback(async () => {
    if (!user) {
      setFriends(null);
      contactsRef.current = [];
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
      //    El clamp es solo un techo de seguridad: las consultas a relays se
      //    trocean por autor, así que no perdemos follows con muchas cuentas.
      const rawContacts = await fetchContacts(user.pubkey);
      if (rawContacts.length === 0) {
        setFriends([]);
        writeCache(user.pubkey, []);
        contactsRef.current = [];
        return;
      }
      const contacts = clampContacts(rawContacts);
      contactsRef.current = contacts;

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
      const pOnline = fetchOnlineInStore(contacts).then((online) => {
        merge((f) => ({ ...f, onlineInStore: online.has(f.pubkey) }));
      });

      await Promise.allSettled([pProfiles, pStatuses, pKnown, pOnline]);
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

  // Poll liviano de estados NIP-38: la presencia "jugando" cambia mucho más
  // rápido que la lista de amigos, y sin esto el riel sólo se enteraba al montar
  // o al volver el foco (throttle 60s) — un amigo que abría el juego tardaba
  // minutos en aparecer como jugando. Consulta SOLO kind:30315 de los contactos
  // ya cargados (una query a relays); no re-descarga contactos ni perfiles.
  useEffect(() => {
    if (!user) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      if (loadingRef.current) return;
      const contacts = contactsRef.current;
      if (contacts.length === 0) return;
      try {
        // "Jugando" (NIP-38) y "conectado" (web abierta) se refrescan a la misma
        // cadencia. Ninguno reordena la lista (sortFriends sólo mira "jugando").
        const [statuses, online] = await Promise.all([
          fetchStatuses(contacts),
          fetchOnlineInStore(contacts),
        ]);
        setFriends((prev) =>
          prev
            ? sortFriends(applyOnlineInStore(applyFreshStatuses(prev, statuses), online))
            : prev,
        );
      } catch {
        /* best-effort: el próximo tick o el refresco por foco lo cubren */
      }
    };
    const id = window.setInterval(() => void tick(), STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [user]);

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
