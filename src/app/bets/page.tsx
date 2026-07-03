"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { satsLabel, hueFromSlug } from "@/lib/format";
import {
  ACTIVE_BET_STATUSES,
  betStatusLabel,
  betTone,
  toneAccent,
} from "@/lib/bet-ui";
import type { MyBetRow } from "@/app/api/me/bets/route";

// Fila unificada v1+v2 (misma forma que el endpoint /api/me/bets).
type Row = MyBetRow;

// El detalle vive en rutas distintas según la versión: v2 (zaps) en /apuestas,
// v1 (escrow) en /bets.
function betHref(b: Row): string {
  return b.version === 2 ? `/apuestas/${b.id}` : `/bets/${b.id}`;
}

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
      className="relative overflow-hidden rounded-ln-lg border border-ln-border bg-ln-card/60 p-4 pl-5"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <p className="ln-label">{label}</p>
      <p className="mt-1 font-display text-[27px] font-extrabold leading-none text-ln-text">
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[11.5px] text-ln-muted">{sub}</p> : null}
    </div>
  );
}

/** CTA contextual según el estado real de la apuesta y mi depósito. */
function ctaFor(b: Row): { label: string; play?: boolean } {
  if (b.status === "pending_deposits" && b.depositStatus !== "paid") {
    return { label: `⚡ Depositar ${satsLabel(b.stakeSats)} sats` };
  }
  if (b.status === "ready" || b.status === "settling") {
    return { label: "▶ Entrar a la sala", play: true };
  }
  return { label: "Ver detalle" };
}

function DuelCard({ b }: { b: Row }) {
  const tone = betTone(b.status, b.result);
  const cta = ctaFor(b);
  return (
    <Link
      href={betHref(b)}
      className="group flex flex-col gap-3 rounded-ln-lg border border-ln-border bg-ln-card/60 p-4 transition-[transform,border-color] duration-150 hover:-translate-y-[3px] hover:border-ln-luna/40"
    >
      <div className="flex items-center gap-3">
        <span
          className="cover h-12 w-12 shrink-0 rounded-ln-md"
          style={{ "--h": hueFromSlug(b.gameSlug) } as CSSProperties}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ln-text">
            {b.gameTitle}
          </p>
          <span
            className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              color: toneAccent(tone),
              background: `color-mix(in srgb, ${toneAccent(tone)} 15%, transparent)`,
            }}
          >
            {betStatusLabel(b.status)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-ln-md border border-ln-border bg-ln-bg-deep/60 px-3 py-2">
        <span className="ln-label">Tu stake</span>
        <span className="font-mono text-sm font-semibold text-ln-corona-bright">
          {satsLabel(b.stakeSats)} sats
        </span>
      </div>

      {b.payoutStatus === "paid" && b.payoutDestination ? (
        <p className="truncate text-[11px] text-ln-faint">
          💸 Premio a{" "}
          <span className="font-mono text-ln-muted">{b.payoutDestination}</span>
        </p>
      ) : (
        <p className="text-[11px] text-ln-faint">
          Comisión 4% · el ganador se lleva el pozo neto.
        </p>
      )}

      <span
        className={`btn w-full ${cta.play ? "btn-aurora" : "btn-corona"}`}
      >
        {cta.label}
      </span>
    </Link>
  );
}

export default function BetsPage() {
  const { user, login, loading } = useSession();
  const [bets, setBets] = useState<Row[] | null>(null);
  const [tab, setTab] = useState<"active" | "history">("active");

  useEffect(() => {
    if (!user) return;
    fetch("/api/me/bets")
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
    const winRate = settled.length
      ? Math.round((won / settled.length) * 100)
      : 0;
    return {
      escrowSats,
      activeCount: active.length,
      won,
      settledTotal: settled.length,
      winRate,
    };
  }, [bets]);

  if (loading) return null;
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-[22px] py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold text-white">
          Tus apuestas
        </h1>
        <p className="mt-2 text-ln-muted">
          Conectá tu Nostr para ver tus apuestas.
        </p>
        <div className="mt-4 flex justify-center">
          <Button variant="luna" onClick={login}>
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
    <div className="mx-auto max-w-[1240px] px-[22px] py-8">
      <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
        Tus apuestas
      </h1>
      <p className="mt-1 flex items-center gap-2 text-sm text-ln-muted">
        Duelos con escrow en Lightning.
        <span className="rounded-full bg-ln-aurora/15 px-2 py-0.5 text-[11px] font-medium text-ln-aurora">
          ● Escrow Lightning activo
        </span>
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Kpi
          label="En juego ahora"
          value={satsLabel(kpis.escrowSats)}
          sub="sats en escrow"
          accent="var(--ln-corona)"
        />
        <Kpi
          label="Ganadas"
          value={`${kpis.won} / ${kpis.settledTotal}`}
          sub={`${kpis.winRate}% efectividad`}
          accent="var(--ln-aurora)"
        />
        <Kpi
          label="Duelos activos"
          value={String(kpis.activeCount)}
          sub="con depósito o en juego"
          accent="var(--ln-luna)"
        />
      </div>

      <div className="mt-7 inline-flex rounded-full border border-ln-border bg-ln-card/60 p-0.5 text-sm">
        {(
          [
            ["active", "Duelos activos"],
            ["history", "Historial"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 transition-colors ${
              tab === key
                ? "bg-ln-luna/15 text-white ring-1 ring-inset ring-ln-luna/25"
                : "text-ln-muted hover:text-ln-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {bets === null ? (
          <p className="text-sm text-ln-faint">Cargando…</p>
        ) : tab === "active" ? (
          <div className="grid gap-[18px] ln:grid-cols-2">
            {shown.map((b) => (
              <DuelCard key={b.id} b={b} />
            ))}
            {/* Las apuestas se crean desde un juego (game server / sala). */}
            <Link
              href="/"
              className="flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-ln-lg border border-dashed border-ln-luna/40 p-4 text-center text-ln-muted transition-colors hover:border-ln-luna/70 hover:text-ln-text"
            >
              <span className="text-2xl text-ln-luna">+</span>
              <span className="text-sm font-medium">Crear un duelo</span>
              <span className="text-[11px] text-ln-faint">
                Desde un juego con salas, invitá y apostá
              </span>
            </Link>
          </div>
        ) : shown.length === 0 ? (
          <p className="text-ln-muted">
            Todavía no tenés apuestas en tu historial.
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((b) => {
              const tone = betTone(b.status, b.result);
              return (
                <li key={b.id}>
                  <Link
                    href={betHref(b)}
                    className="flex items-center justify-between gap-3 rounded-ln-md border border-ln-border border-l-[3px] bg-ln-card/60 px-4 py-3 transition-colors hover:bg-white/[.02]"
                    style={{ borderLeftColor: toneAccent(tone) }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="cover h-9 w-9 shrink-0 rounded-ln-sm"
                        style={
                          { "--h": hueFromSlug(b.gameSlug) } as CSSProperties
                        }
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ln-text">
                          {b.gameTitle}
                        </p>
                        <p className="mt-0.5 text-xs text-ln-faint">
                          {betStatusLabel(b.status)}
                          {b.status === "settled" && b.result === "won"
                            ? " · ganaste"
                            : b.status === "settled" && b.result === "lost"
                              ? " · perdiste"
                              : b.status === "settled" && b.result === "tie"
                                ? " · empate"
                                : ""}
                        </p>
                        {b.payoutStatus === "paid" &&
                        b.payoutDestination &&
                        b.payoutDestination !== "lnurl-withdraw" ? (
                          <p className="mt-0.5 truncate text-[11px] text-ln-faint">
                            💸 Premio a{" "}
                            <span className="font-mono text-ln-muted">
                              {b.payoutDestination}
                            </span>
                          </p>
                        ) : b.payoutStatus === "claimed" ? (
                          <p className="mt-0.5 text-[11px] text-ln-faint">
                            🎟️ Cobrado por QR (retiro)
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-semibold text-ln-corona-bright">
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
