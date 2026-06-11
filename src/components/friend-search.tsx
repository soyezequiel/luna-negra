"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  searchProfiles,
  profileName,
  shortId,
  type GlobalResult,
} from "@/lib/nostr-social";
import type { Friend } from "@/hooks/use-friends";

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
}: {
  friends: Friend[] | null;
  onResults: (r: FriendSearchResults | null) => void;
  compact?: boolean;
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

    const needle = q.toLowerCase();
    const local = (friends ?? []).filter(
      (f) =>
        f.npub.toLowerCase().includes(needle) ||
        profileName(f.profile, f.npub).toLowerCase().includes(needle),
    );

    // Hay match local o la query es muy corta: no buscamos en todo Nostr.
    if (local.length > 0 || q.length < 3) {
      startTransition(() => {
        onResults({ local, global: [] });
        setSearching(false);
      });
      return;
    }

    startTransition(() => {
      onResults({ local, global: [] });
      setSearching(true);
    });
    const t = setTimeout(async () => {
      try {
        const global = await searchProfiles(q, 10);
        if (lastQuery.current !== q) return; // respuesta obsoleta
        const followPks = new Set((friends ?? []).map((f) => f.pubkey));
        onResults({
          local,
          global: global.filter((g) => !followPks.has(g.pubkey)),
        });
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
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar amigo (nombre, npub o NIP-05)…"
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
