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
  subscribeStatuses,
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
  /**
   * El servidor lo ve activo ahora (respuesta de /api/users/online): tiene la web
   * abierta (`StorePresence`) o está jugando algún juego detectado por la API
   * (`GamePresence`, sobrevive con la tienda cerrada). NO se persiste en el caché
   * de localStorage (la DB lo re-deriva barato en cada poll). "Conectado" = status
   * (jugando vía NIP-38) o esto.
   */
  onlineInStore?: boolean;
  /**
   * Presencia NIP-38 "Jugando X" (kind:30315). SÍ se persiste en el caché de
   * localStorage —con su expiración (`Status.expiresAt`)— para pintarla al
   * instante tras un refresco; al leer se descarta si ya venció
   * (`dropExpiredStatuses`) y el poll de estados la reconcilia contra los relays.
   */
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

// Cadencia del poll de estados NIP-38. Como kind:30315 es reemplazable, el relay
// siempre devuelve el estado vigente: sondear más rápido que la re-publicación del
// juego (~120s) NO trae nada viejo, sólo detecta antes al amigo que empieza a
// jugar. Bajado a 10s (era 30s → detección de ~1min en el peor caso) para que
// "Jugando X" aparezca casi en vivo; sigue siendo una sola query por tick, y sólo
// mientras la pestaña está visible. Además refrescamos al toque al volver el foco
// (ver el listener de visibilidad más abajo).
const STATUS_POLL_MS = 10_000;

// Cadencia del poll de "conectado" (StorePresence/GamePresence). Va contra
// nuestra propia DB (una query indexada, barata), no contra relays, así que lo
// consultamos más seguido que el estado NIP-38 para que conectarse/desconectarse
// se vea casi en vivo sin tener que refrescar el navegador.
const PRESENCE_POLL_MS = 10_000;

function readCache(pubkey: string): Friend[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey));
    if (!raw) return null;
    const cached = JSON.parse(raw) as Friend[];
    // Al leer descartamos la presencia NIP-38 ya vencida: persistimos el status
    // para pintar "Jugando X" al instante tras un refresco, pero si su expiración
    // (NIP-40) ya pasó no la mostramos (el relay tampoco la daría por fresca).
    return Array.isArray(cached) ? dropExpiredStatuses(stripStorePresence(cached)) : null;
  } catch {
    return null;
  }
}

function writeCache(pubkey: string, friends: Friend[]) {
  try {
    localStorage.setItem(
      cacheKey(pubkey),
      JSON.stringify(stripStorePresence(friends)),
    );
  } catch {
    /* cuota llena o storage no disponible: ignorar */
  }
}

/**
 * Quita del caché la presencia "conectado" (`onlineInStore`): la deriva la DB en
 * cada poll (barato), así que no tiene sentido persistir un puntito verde que
 * puede estar viejo. La presencia NIP-38 (`status`) SÍ se persiste: lleva su
 * propia expiración y se descarta al leer con `dropExpiredStatuses`.
 */
export function stripStorePresence(friends: Friend[]): Friend[] {
  return friends.map((friend) => {
    const cached = { ...friend };
    delete cached.onlineInStore;
    return cached;
  });
}

/**
 * Descarta el status NIP-38 cacheado cuya expiración ya pasó, dejando el resto
 * del amigo intacto. Así una presencia "Jugando X" que ya venció (el juego se
 * cerró, o el relay no vuelve a confirmarla) desaparece sola sin esperar al poll.
 */
export function dropExpiredStatuses(
  friends: Friend[],
  nowSec: number = Math.floor(Date.now() / 1000),
): Friend[] {
  let changed = false;
  const next = friends.map((friend) => {
    if (friend.status && friend.status.expiresAt <= nowSec) {
      changed = true;
      const copy = { ...friend };
      delete copy.status;
      return copy;
    }
    return friend;
  });
  // Misma referencia si no venció nada: evita re-renders inútiles en el barrido.
  return changed ? next : friends;
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
  // Versión reactiva del set de contactos (join de pubkeys ordenadas): dispara la
  // (re)suscripción persistente de estados cuando la lista cambia. El ref de arriba
  // lo leen los ticks; este `key` es solo para las deps del effect de la sub.
  const [contactsKey, setContactsKey] = useState("");

  const load = useCallback(async () => {
    if (!user) {
      setFriends(null);
      contactsRef.current = [];
      setContactsKey("");
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
        setContactsKey("");
        return;
      }
      const contacts = clampContacts(rawContacts);
      contactsRef.current = contacts;
      // `key` estable ante reordenamientos: solo cambia si el SET de contactos cambia.
      setContactsKey([...contacts].sort().join(","));

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
        const statuses = await fetchStatuses(contacts);
        setFriends((prev) =>
          prev ? sortFriends(applyFreshStatuses(prev, statuses)) : prev,
        );
      } catch {
        /* best-effort: el próximo tick o el refresco por foco lo cubren */
      }
    };
    const id = window.setInterval(() => void tick(), STATUS_POLL_MS);
    // Al volver el foco a la pestaña, refrescamos los estados de una (sin esperar
    // al próximo tick): así un amigo que empezó a jugar mientras estabas en otra
    // pestaña aparece "Jugando X" apenas volvés. Es una sola query de estados
    // (no el load() completo, que está aparte con su throttle de 60s).
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user]);

  // Suscripción PERSISTENTE a los estados NIP-38 de los contactos: cada cambio
  // (un amigo empieza o deja de jugar) llega en TIEMPO REAL y se pinta al instante,
  // sin esperar al poll de 10s ni obligar a refrescar la página. El poll de arriba
  // queda solo como red de respaldo (arranque, foco, reconexión de relays). Se
  // re-suscribe cuando cambia el SET de contactos (`contactsKey`), no en cada carga.
  useEffect(() => {
    if (!user) return;
    const contacts = contactsRef.current;
    if (contacts.length === 0) return;
    const unsub = subscribeStatuses(contacts, (pubkey, status) => {
      setFriends((prev) => {
        if (!prev) return prev;
        const i = prev.findIndex((f) => f.pubkey === pubkey);
        if (i < 0) return prev;
        const cur = prev[i].status;
        // Sin cambios reales (mismo contenido y vencimiento) → no re-render/re-sort.
        const same =
          (cur?.content ?? null) === (status?.content ?? null) &&
          (cur?.expiresAt ?? 0) === (status?.expiresAt ?? 0) &&
          (cur?.url ?? null) === (status?.url ?? null);
        if (same) return prev;
        const next = prev.slice();
        next[i] = { ...next[i], status: status ?? undefined };
        return sortFriends(next);
      });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, contactsKey]);

  // Barrido local de presencias NIP-38 vencidas: si la expiración (NIP-40) de un
  // "Jugando X" ya pasó, lo bajamos sin esperar al poll de relays. Cubre el caso
  // en que los relays no responden (el poll de arriba conserva el estado previo en
  // su `catch`): así una presencia igual se va cuando le toca vencer, cumpliendo
  // "si no vuelve a aparecer la señal, que se vaya". Barato: sólo re-renderiza si
  // algo venció (dropExpiredStatuses devuelve el mismo array si no cambió nada).
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => {
      setFriends((prev) => (prev ? dropExpiredStatuses(prev) : prev));
    }, 5_000);
    return () => window.clearInterval(id);
  }, [user]);

  // Poll de "conectado" (StorePresence/GamePresence), separado del de NIP-38: va
  // contra nuestra DB (barato), así que corre más seguido para que el puntito
  // verde reaccione casi en vivo a que un amigo abra/cierre la tienda o entre a
  // un juego, sin obligar a refrescar el navegador. Sólo toca `onlineInStore`, no
  // reordena (sortFriends sólo mira "jugando"), así no pelea con el poll NIP-38.
  useEffect(() => {
    if (!user) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      if (loadingRef.current) return;
      const contacts = contactsRef.current;
      if (contacts.length === 0) return;
      try {
        const online = await fetchOnlineInStore(contacts);
        setFriends((prev) =>
          prev ? applyOnlineInStore(prev, online) : prev,
        );
      } catch {
        /* best-effort: el próximo tick lo cubre */
      }
    };
    const id = window.setInterval(() => void tick(), PRESENCE_POLL_MS);
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
