"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/providers/session-provider";
import {
  fetchContacts,
  fetchProfiles,
  fetchStatuses,
  npubOf,
  profileName,
  type Profile,
  type Status,
} from "@/lib/nostr-social";

export type Friend = {
  pubkey: string;
  npub: string;
  profile?: Profile;
  isMember: boolean;
  games: { slug: string; title: string }[];
  status?: Status;
};

type Known = {
  pubkey: string;
  npub: string;
  displayName: string | null;
  games: { slug: string; title: string }[];
};

// --- Caché local (stale-while-revalidate): mostrar amigos al instante al
// volver, mientras se refresca en segundo plano desde los relays. ---
const cacheKey = (pubkey: string) => `friends:${pubkey}`;

function readCache(pubkey: string): Friend[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey));
    return raw ? (JSON.parse(raw) as Friend[]) : null;
  } catch {
    return null;
  }
}

function writeCache(pubkey: string, friends: Friend[]) {
  try {
    localStorage.setItem(cacheKey(pubkey), JSON.stringify(friends));
  } catch {
    /* cuota llena o storage no disponible: ignorar */
  }
}

function sortFriends(list: Friend[]): Friend[] {
  return [...list].sort((a, b) => {
    if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
    return profileName(a.profile, a.npub).localeCompare(
      profileName(b.profile, b.npub),
    );
  });
}

/**
 * Carga la lista de amigos (contactos Nostr del usuario) enriquecida con perfil,
 * estado NIP-38, si son miembros de Luna Negra y sus juegos. Usa caché local
 * para pintar al instante y refresca desde los relays en segundo plano.
 */
export function useFriends(): { friends: Friend[] | null } {
  const { user } = useSession();
  const [friends, setFriends] = useState<Friend[] | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setFriends(null);
      return;
    }

    // 1) Caché: pintar al instante lo último que vimos (se refresca abajo).
    const cached = readCache(user.pubkey);
    if (cached && cached.length > 0) setFriends(cached);

    // 2) Contactos: apenas llegan, mostramos la lista (nombre/avatar se
    //    completan después). Conservamos datos enriquecidos del caché por pk.
    const contacts = await fetchContacts(user.pubkey);
    if (contacts.length === 0) {
      setFriends([]);
      writeCache(user.pubkey, []);
      return;
    }

    const cachedByPk = new Map((cached ?? []).map((f) => [f.pubkey, f]));
    let list: Friend[] = contacts.map((pk) => {
      const prev = cachedByPk.get(pk);
      return {
        pubkey: pk,
        npub: npubOf(pk),
        profile: prev?.profile,
        isMember: prev?.isMember ?? false,
        games: prev?.games ?? [],
        status: prev?.status,
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
    const pStatuses = fetchStatuses(contacts).then((statuses) =>
      merge((f) => ({ ...f, status: statuses[f.pubkey] ?? f.status })),
    );
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
          return { ...f, isMember: Boolean(k), games: k?.games ?? [] };
        });
      });

    await Promise.allSettled([pProfiles, pStatuses, pKnown]);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return { friends };
}
