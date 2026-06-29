"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GameStatsDashboard } from "@/components/stats/game-stats-dashboard";
import type { GameStats, StatsRange } from "@/lib/game-stats";

type GameRow = { id: string; title: string; slug: string };
type ProviderRow = { id: string; name: string; games: GameRow[] };

export default function AdminStatsPage() {
  const { user, login, loading } = useSession();
  const [catalog, setCatalog] = useState<ProviderRow[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const [gameId, setGameId] = useState<string>("");
  const [range, setRange] = useState<StatsRange>("30d");
  const [stats, setStats] = useState<GameStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Carga el catálogo (proveedores + juegos) una vez.
  const loadCatalog = useCallback(async () => {
    const r = await fetch("/api/admin/stats");
    if (r.status === 403) {
      setForbidden(true);
      setLoaded(true);
      return;
    }
    const d = await r.json().catch(() => ({ catalog: [] }));
    setForbidden(false);
    setCatalog(d.catalog ?? []);
    setLoaded(true);
  }, []);

  const loadStats = useCallback(async (gid: string, r: StatsRange) => {
    if (!gid) {
      setStats(null);
      return;
    }
    setBusy(true);
    try {
      const params = new URLSearchParams({ gameId: gid, range: r });
      const d = await fetch(`/api/admin/stats?${params}`)
        .then((res) => res.json())
        .catch(() => null);
      setStats(d?.stats ?? null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Carga inicial del catálogo: fetch async, el setState ocurre tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void loadCatalog();
  }, [user, loadCatalog]);

  function selectProvider(pid: string) {
    setProviderId(pid);
    const first = catalog.find((p) => p.id === pid)?.games[0]?.id ?? "";
    setGameId(first);
    void loadStats(first, range);
  }
  function selectGame(id: string) {
    setGameId(id);
    void loadStats(id, range);
  }
  function selectRange(r: StatsRange) {
    setRange(r);
    void loadStats(gameId, r);
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Estadísticas (admin)</h1>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-muted">
        No estás autorizado para ver esta página.
      </div>
    );
  }

  const provider = catalog.find((p) => p.id === providerId);

  return (
    <div className="mx-auto max-w-[1040px] px-[22px] py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Estadísticas
          </h1>
          <p className="mt-1 text-sm text-ln-muted">
            Vista de admin: estadísticas de cualquier juego del catálogo.
          </p>
        </div>
        <Link href="/admin" className="btn btn-ghost shrink-0 self-start">
          Volver al panel
        </Link>
      </div>

      {!loaded ? (
        <p className="mt-6 text-sm text-ln-faint">Cargando…</p>
      ) : catalog.length === 0 ? (
        <p className="mt-6 text-sm text-ln-faint">No hay juegos en el catálogo.</p>
      ) : (
        <>
          {/* Selector de proveedor */}
          <div className="mt-6">
            <label className="ln-label">Proveedor</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {catalog.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p.id)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-[13px] font-semibold transition-colors",
                    providerId === p.id
                      ? "border-ln-luna/50 bg-ln-luna/15 text-ln-luna"
                      : "border-ln-border text-ln-muted hover:text-ln-text",
                  )}
                >
                  {p.name}{" "}
                  <span className="text-ln-faint">({p.games.length})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selector de juego */}
          {provider ? (
            <div className="mt-4">
              <label className="ln-label">Juego</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {provider.games.map((gm) => (
                  <button
                    key={gm.id}
                    type="button"
                    onClick={() => selectGame(gm.id)}
                    className={cn(
                      "rounded-full border px-4 py-1.5 text-[13px] font-semibold transition-colors",
                      gameId === gm.id
                        ? "border-blue/50 bg-blue/15 text-blue"
                        : "border-ln-border text-ln-muted hover:text-ln-text",
                    )}
                  >
                    {gm.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-6">
            {!providerId ? (
              <p className="text-sm text-ln-faint">Elegí un proveedor para empezar.</p>
            ) : (
              <GameStatsDashboard
                stats={stats}
                range={range}
                onRangeChange={selectRange}
                loading={busy}
                showHouse
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
