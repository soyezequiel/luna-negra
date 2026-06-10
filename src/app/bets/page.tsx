"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { satsLabel } from "@/lib/format";
import {
  ACTIVE_BET_STATUSES,
  betStatusLabel,
  betTone,
  toneAccent,
} from "@/lib/bet-ui";

type Row = {
  id: string;
  gameTitle: string;
  gameSlug: string;
  status: string;
  stakeSats: number;
  result: string;
};

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded border border-line bg-panel p-4 pl-5"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
        {label}
      </p>
      <p className="mt-1 text-[25px] font-bold leading-none text-ink">{value}</p>
      {sub ? <p className="mt-1.5 text-[11.5px] text-muted">{sub}</p> : null}
    </div>
  );
}

export default function BetsPage() {
  const { user, login, loading } = useSession();
  const [bets, setBets] = useState<Row[] | null>(null);
  const [tab, setTab] = useState<"active" | "history">("active");

  useEffect(() => {
    if (!user) return;
    fetch("/api/escrow/bets/mine")
      .then((r) => r.json())
      .then((d) => setBets(d.bets ?? []))
      .catch(() => setBets([]));
  }, [user]);

  const kpis = useMemo(() => {
    const list = bets ?? [];
    const active = list.filter((b) => ACTIVE_BET_STATUSES.has(b.status));
    const settled = list.filter((b) => b.status === "settled");
    const won = settled.filter((b) => b.result === "won").length;
    const escrowSats = active.reduce((s, b) => s + b.stakeSats, 0);
    const wageredSats = list.reduce((s, b) => s + b.stakeSats, 0);
    // Neto aproximado para 1v1 con stakes iguales: ganar ≈ +stake, perder ≈ -stake.
    const netSats = settled.reduce(
      (s, b) =>
        b.result === "won"
          ? s + b.stakeSats
          : b.result === "lost"
            ? s - b.stakeSats
            : s,
      0,
    );
    const winRate = settled.length ? Math.round((won / settled.length) * 100) : 0;
    return {
      escrowSats,
      wageredSats,
      netSats,
      won,
      settledTotal: settled.length,
      winRate,
    };
  }, [bets]);

  if (loading) return null;
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Tus apuestas</h1>
        <p className="mt-2 text-muted">Conectá tu Nostr para ver tus apuestas.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>
            Conectar con Nostr
          </Button>
        </div>
      </div>
    );
  }

  const list = bets ?? [];
  const shown =
    tab === "active"
      ? list.filter((b) => ACTIVE_BET_STATUSES.has(b.status))
      : list.filter((b) => !ACTIVE_BET_STATUSES.has(b.status));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-white">
        Tus apuestas
      </h1>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="En juego ahora"
          value={satsLabel(kpis.escrowSats)}
          sub="sats en escrow"
          accent="var(--btc)"
        />
        <Kpi
          label="Ganadas"
          value={`${kpis.won} / ${kpis.settledTotal}`}
          sub={`${kpis.winRate}% win rate`}
          accent="var(--win)"
        />
        <Kpi
          label="Neto histórico"
          value={`${kpis.netSats >= 0 ? "+" : ""}${satsLabel(kpis.netSats)}`}
          sub="sats (aprox. 1v1)"
          accent="var(--win)"
        />
        <Kpi
          label="Total apostado"
          value={satsLabel(kpis.wageredSats)}
          sub="sats"
          accent="var(--btc)"
        />
      </div>

      <div className="mt-7 inline-flex rounded-sm border border-line bg-panel p-0.5 text-sm">
        {(
          [
            ["active", "En juego"],
            ["history", "Historial"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-sm px-4 py-1.5 transition-colors ${
              tab === key
                ? "bg-blue/20 text-white ring-1 ring-inset ring-blue/40"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {bets === null ? (
          <p className="text-sm text-faint">Cargando…</p>
        ) : shown.length === 0 ? (
          <p className="text-muted">
            {tab === "active"
              ? "No tenés apuestas en juego ahora mismo."
              : "Todavía no tenés apuestas en tu historial."}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((b) => {
              const tone = betTone(b.status, b.result);
              return (
                <li key={b.id}>
                  <Link
                    href={`/bets/${b.id}`}
                    className="flex items-center justify-between gap-3 rounded border border-line border-l-[3px] bg-panel px-4 py-3 transition-colors hover:bg-white/[.02]"
                    style={{ borderLeftColor: toneAccent(tone) }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {b.gameTitle}
                      </p>
                      <p className="mt-0.5 text-xs text-faint">
                        {betStatusLabel(b.status)}
                        {b.status === "settled" && b.result === "won"
                          ? " · ganaste"
                          : b.status === "settled" && b.result === "lost"
                            ? " · perdiste"
                            : b.status === "settled" && b.result === "tie"
                              ? " · empate"
                              : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-semibold text-btc">
                      {satsLabel(b.stakeSats)} sats
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
