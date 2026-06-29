"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GameStatsDashboard } from "@/components/stats/game-stats-dashboard";
import type { GameStats, StatsRange } from "@/lib/game-stats";

type GameRow = { id: string; title: string; slug: string };

export default function ProviderStatsPage() {
  const { user, login, loading } = useSession();
  const [games, setGames] = useState<GameRow[]>([]);
  const [gameId, setGameId] = useState<string>("");
  const [range, setRange] = useState<StatsRange>("30d");
  const [stats, setStats] = useState<GameStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(
    async (gid: string, r: StatsRange) => {
      setBusy(true);
      try {
        const params = new URLSearchParams({ range: r });
        if (gid) params.set("gameId", gid);
        const d = await fetch(`/api/provider/stats?${params}`)
          .then((res) => res.json())
          .catch(() => null);
        setGames(d?.games ?? []);
        setStats(d?.stats ?? null);
        if (d?.stats?.game?.id) setGameId(d.stats.game.id);
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    },
    [],
  );

  useEffect(() => {
    // Carga inicial al montar (muestra loading vía setBusy); patrón fetch-on-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void load(gameId, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function selectGame(id: string) {
    setGameId(id);
    void load(id, range);
  }
  function selectRange(r: StatsRange) {
    setRange(r);
    void load(gameId, r);
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Estadísticas</h1>
        <p className="mt-2 text-muted">Conectá tu Nostr para ver las estadísticas de tus juegos.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1040px] px-[22px] py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Estadísticas
          </h1>
          <p className="mt-1 text-sm text-ln-muted">
            Rendimiento de tus juegos: jugadores, ingresos, apuestas y zaps.
          </p>
        </div>
        <Link href="/provider" className="btn btn-ghost shrink-0 self-start">
          Volver al panel
        </Link>
      </div>

      {!loaded ? (
        <p className="mt-6 text-sm text-ln-faint">Cargando…</p>
      ) : games.length === 0 ? (
        <p className="mt-6 text-sm text-ln-faint">
          Todavía no tenés juegos. Creá uno en el{" "}
          <Link href="/provider" className="text-blue hover:underline">panel de proveedor</Link>.
        </p>
      ) : (
        <>
          {games.length > 1 ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {games.map((gm) => (
                <button
                  key={gm.id}
                  type="button"
                  onClick={() => selectGame(gm.id)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-[13px] font-semibold transition-colors",
                    gameId === gm.id
                      ? "border-ln-luna/50 bg-ln-luna/15 text-ln-luna"
                      : "border-ln-border text-ln-muted hover:text-ln-text",
                  )}
                >
                  {gm.title}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-6">
            <GameStatsDashboard
              stats={stats}
              range={range}
              onRangeChange={selectRange}
              loading={busy}
            />
          </div>
        </>
      )}
    </div>
  );
}
