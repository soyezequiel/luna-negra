"use client";

import { useEffect, useRef, useState, useTransition, type Ref } from "react";
import {
  searchProfiles,
  profileName,
  shortId,
  type GlobalResult,
} from "@/lib/nostr-social";
import type { Friend } from "@/hooks/use-friends";

/** Match local de un follow: nombre, npub o NIP-05 (case-insensitive). */
function matchesFriend(f: Friend, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    f.npub.toLowerCase().includes(needle) ||
    profileName(f.profile, f.npub).toLowerCase().includes(needle) ||
    (f.profile?.nip05?.toLowerCase().includes(needle) ?? false)
  );
}

export type FriendSearchResults = {
  local: Friend[];
  global: GlobalResult[];
};

/**
 * Buscador de amigos: filtra al instante los follows cargados; si no hay match
 * (y la query es suficientemente larga), busca en TODO Nostr (NIP-50 / NIP-05 /
 * npub). `onResults(null)` cuando no hay query activa (mostrar la lista normal).
 */
export function FriendSearch({
  friends,
  onResults,
  compact,
  inputRef,
}: {
  friends: Friend[] | null;
  onResults: (r: FriendSearchResults | null) => void;
  compact?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [, startTransition] = useTransition();
  // Última query con la que disparamos para descartar respuestas tardías.
  const lastQuery = useRef("");

  useEffect(() => {
    const q = query.trim();
    lastQuery.current = q;
    if (!q) {
      startTransition(() => {
        onResults(null);
        setSearching(false);
      });
      return;
    }

    const local = (friends ?? []).filter((f) => matchesFriend(f, q));

    // Query muy corta: solo filtro local, sin pegarle a los relays.
    if (q.length < 3) {
      startTransition(() => {
        onResults({ local, global: [] });
        setSearching(false);
      });
      return;
    }

    // Siempre buscamos también en todo Nostr: así aparece aunque no lo sigas, y
    // también si lo seguís pero su perfil (kind:0) todavía no se había cargado
    // —en ese caso el filtro local fallaba por nombre—. Los follows que
    // aparezcan en la búsqueda global se promueven a "Tus amigos".
    startTransition(() => {
      onResults({ local, global: [] });
      setSearching(true);
    });
    const t = setTimeout(async () => {
      try {
        const found = await searchProfiles(q, 10);
        if (lastQuery.current !== q) return; // respuesta obsoleta
        const followByPk = new Map((friends ?? []).map((f) => [f.pubkey, f]));
        const localPks = new Set(local.map((f) => f.pubkey));
        const extraLocal: Friend[] = [];
        const global: GlobalResult[] = [];
        for (const r of found) {
          const follow = followByPk.get(r.pubkey);
          if (follow) {
            // Lo seguís: si no estaba ya en el filtro local (perfil sin cargar),
            // lo sumamos con el perfil que trajo la búsqueda.
            if (!localPks.has(r.pubkey)) {
              extraLocal.push({ ...follow, profile: follow.profile ?? r.profile });
            }
          } else {
            global.push(r);
          }
        }
        onResults({ local: [...local, ...extraLocal], global });
      } catch {
        if (lastQuery.current === q) onResults({ local, global: [] });
      } finally {
        if (lastQuery.current === q) setSearching(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query, friends, onResults, startTransition]);

  return (
    <div className={compact ? "relative" : "relative mt-4"}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar amigo o usuario de Nostr (nombre, npub o NIP-05)…"
        className={
          compact
            ? "w-full rounded-md border border-line bg-black/20 px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-blue/30"
            : "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-blue/30"
        }
      />
      {searching ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">
          Buscando en Nostr…
        </span>
      ) : null}
    </div>
  );
}

/** Etiqueta de un resultado global para reutilizar en ambas vistas. */
export function globalResultName(r: GlobalResult): string {
  return profileName(r.profile, shortId(r.npub));
}
