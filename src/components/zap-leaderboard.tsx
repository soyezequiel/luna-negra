"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import {
  fetchProfiles,
  profileName,
  npubOf,
  shortId,
  type Profile,
} from "@/lib/nostr-social";

type Entry = { pubkey: string; totalSats: number; count: number };

type Props =
  | { scope: "game"; gameId: string; title?: string }
  | { scope: "provider"; providerId: string; title?: string };

const MEDALS = ["🥇", "🥈", "🥉"] as const;

/**
 * Top de zappers (NIP-57). Lee de /api/zaps/top (que sale de los recibos 9735
 * verificados por zap-sync.ts) y resuelve nombre/avatar desde Nostr. Reutilizable
 * por juego (`scope="game"`) o por dev (`scope="provider"`). Escucha el evento
 * `luna:zapped` para refrescar cuando alguien zapea desde esta misma página (el
 * recibo tarda un tick en aparecer, así que reintenta unas veces).
 */
export function ZapLeaderboard(props: Props) {
  const { scope } = props;
  const id = scope === "game" ? props.gameId : props.providerId;
  const title = props.title ?? "Top zappers ⚡";

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [, startLoadTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const qs = scope === "game" ? `gameId=${id}` : `providerId=${id}`;
      const res = await fetch(`/api/zaps/top?${qs}`);
      if (!res.ok) return;
      const data = (await res.json()) as { entries: Entry[] };
      setEntries(data.entries);
      const pks = [...new Set(data.entries.map((e) => e.pubkey))];
      if (pks.length) setProfiles(await fetchProfiles(pks));
    } catch {
      /* el top es no crítico: si falla, dejamos lo que haya */
    }
  }, [scope, id]);

  useEffect(() => {
    startLoadTransition(() => {
      void load();
    });
  }, [load, startLoadTransition]);

  // Tras un zap propio, el recibo aparece en un tick del sync: reintentamos.
  useEffect(() => {
    const onZapped = () => {
      const delays = [3000, 8000, 15000];
      const timers = delays.map((d) => setTimeout(() => void load(), d));
      return () => timers.forEach(clearTimeout);
    };
    const handler = () => onZapped();
    window.addEventListener("luna:zapped", handler);
    return () => window.removeEventListener("luna:zapped", handler);
  }, [load]);

  if (entries && entries.length === 0) {
    return (
      <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
        <p className="text-sm font-semibold text-ln-text">{title}</p>
        <p className="mt-2 text-[13px] text-ln-muted">
          Todavía no hay zaps. ¡Sé el primero en apoyar! ⚡
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
      <p className="text-sm font-semibold text-ln-text">{title}</p>
      <ul className="mt-3 space-y-2">
        {(entries ?? []).map((e, i) => {
          const p = profiles[e.pubkey];
          const name = profileName(p, shortId(npubOf(e.pubkey)));
          return (
            <li key={e.pubkey} className="flex items-center gap-3">
              <span className="w-6 shrink-0 text-center text-sm">
                {MEDALS[i] ?? <span className="text-ln-faint">{i + 1}</span>}
              </span>
              <Avatar
                src={p?.picture}
                seed={e.pubkey}
                className="h-8 w-8 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ln-text">
                {name}
              </span>
              <span className="shrink-0 text-sm font-semibold text-ln-corona-bright">
                {e.totalSats.toLocaleString("es-AR")} sats
              </span>
            </li>
          );
        })}
        {entries === null
          ? Array.from({ length: 3 }).map((_, i) => (
              <li
                key={`sk-${i}`}
                className="h-8 animate-pulse rounded-ln-lg bg-white/5"
              />
            ))
          : null}
      </ul>
    </div>
  );
}
