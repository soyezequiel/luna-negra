"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { satsLabel, hueFromSlug, timeAgo } from "@/lib/format";
import { normalizeImageUrl } from "@/lib/game-media";
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

/** createdAt viene en ISO; timeAgo espera unix seconds. */
function ago(iso: string): string {
  return timeAgo(Math.floor(new Date(iso).getTime() / 1000));
}

/**
 * Premio estimado para un duelo 1v1 con escrow: el ganador se lleva el pozo
 * (2× stake) menos la comisión del 4%. Es una estimación (no conocemos la
 * cantidad exacta de participantes desde esta fila) → se rotula con "≈".
 */
function estPayout(stakeSats: number): number {
  return Math.round(stakeSats * 2 * 0.96);
}

/** Portada del juego con fallback al gradiente por slug si no hay imagen. */
function GameCover({ b, size }: { b: Row; size: "sm" | "md" | "lg" }) {
  const dim =
    size === "lg"
      ? "h-14 w-14 rounded-ln-md"
      : size === "md"
        ? "h-12 w-12 rounded-ln-md"
        : "h-10 w-10 rounded-ln-sm";
  if (b.gameCoverUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={normalizeImageUrl(b.gameCoverUrl)}
        alt={b.gameTitle}
        referrerPolicy="no-referrer"
        className={`${dim} shrink-0 object-cover`}
      />
    );
  }
  return (
    <span
      className={`cover ${dim} shrink-0`}
      style={{ "--h": hueFromSlug(b.gameSlug) } as CSSProperties}
    />
  );
}

/** Chip que distingue el motor de la apuesta: escrow (v1) o zaps (v2). */
function VersionBadge({ b }: { b: Row }) {
  const zaps = b.version === 2;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-ln-border px-2 py-0.5 text-[10px] font-semibold text-ln-muted"
      title={zaps ? "Apuesta por zaps (NIP-57)" : "Apuesta con escrow Lightning"}
    >
      {zaps ? "⚡ Zaps" : "🔒 Escrow"}
    </span>
  );
}

/** Estado del depósito del jugador, como chip de color. */
function DepositChip({ b }: { b: Row }) {
  const paid = b.depositStatus === "paid";
  const color = paid ? "var(--ln-aurora)" : "var(--ln-corona)";
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium"
      style={{ color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {paid ? "Depósito confirmado" : "Depósito pendiente"}
    </span>
  );
}

function StatusPill({ b }: { b: Row }) {
  const tone = betTone(b.status, b.result);
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{
        color: toneAccent(tone),
        background: `color-mix(in srgb, ${toneAccent(tone)} 15%, transparent)`,
      }}
    >
      {betStatusLabel(b.status)}
    </span>
  );
}

/** Celda de métrica compacta (rótulo arriba, valor abajo) para las tiras. */
function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="ln-label">{label}</p>
      <p
        className={`mt-0.5 truncate font-mono text-sm font-semibold ${valueClass ?? "text-ln-text"}`}
      >
        {value}
      </p>
    </div>
  );
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

/**
 * Resumen de una apuesta cerrada para el historial. La idea es bajar la carga
 * cognitiva: solo ganaste/perdiste resaltan (signo + color); canceladas,
 * reembolsos y empates quedan apagados porque no cambiaron tu saldo.
 */
function outcomeMeta(b: Row): {
  label: string;
  amount: string;
  amountClass: string;
} {
  if (b.status === "settled" && b.result === "won") {
    return {
      label: "Ganaste",
      amount: `+${satsLabel(b.payoutSats ?? b.stakeSats)}`,
      amountClass: "text-ln-aurora-bright",
    };
  }
  if (b.status === "settled" && b.result === "lost") {
    return {
      label: "Perdiste",
      amount: `−${satsLabel(b.stakeSats)}`,
      amountClass: "text-ln-danger",
    };
  }
  // Empate, cancelada, reembolsada, anulada: tu saldo no se movió → sin énfasis.
  const label =
    b.status === "settled" && b.result === "tie"
      ? "Empate"
      : betStatusLabel(b.status);
  return {
    label,
    amount: satsLabel(b.stakeSats),
    amountClass: "text-ln-faint",
  };
}

/** Cómo salió el premio (v2 lo distingue: zap/lnurl/withdraw). */
function payoutKindLabel(kind: string | null): string | null {
  switch (kind) {
    case "zap":
      return "por zap";
    case "lnurl":
      return "a Lightning Address";
    case "withdraw":
      return "por retiro";
    default:
      return null;
  }
}

/** CTA contextual según el estado real de la apuesta y mi depósito. */
function ctaFor(b: Row): { label: string; play?: boolean } {
  if (b.payoutStatus === "withdraw_pending") {
    return { label: "🎟️ Mostrar QR de retiro" };
  }
  if (b.status === "pending_deposits" && b.depositStatus !== "paid") {
    return { label: `⚡ Depositar ${satsLabel(b.stakeSats)} sats` };
  }
  if (b.status === "ready" || b.status === "settling") {
    return { label: "▶ Entrar a la sala", play: true };
  }
  return { label: "Ver detalle" };
}

/**
 * Tarjeta de duelo activo. Ocupa todo el ancho de su columna con una tira de
 * métricas (stake · premio estimado · depósito) para exprimir el espacio en vez
 * de dejar la mitad de la tarjeta vacía.
 */
function DuelCard({ b }: { b: Row }) {
  const cta = ctaFor(b);
  return (
    <Link
      href={betHref(b)}
      className="group flex flex-col gap-3.5 rounded-ln-lg border border-ln-border bg-ln-card/60 p-4 transition-[transform,border-color] duration-150 hover:-translate-y-[3px] hover:border-ln-luna/40"
    >
      <div className="flex items-start gap-3">
        <GameCover b={b} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ln-text">
            {b.gameTitle}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusPill b={b} />
            <VersionBadge b={b} />
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-ln-faint">
          {ago(b.createdAt)}
        </span>
      </div>

      {/* Tira de métricas: aprovecha el ancho con 3 columnas de datos. */}
      <div className="grid grid-cols-3 gap-3 rounded-ln-md border border-ln-border bg-ln-bg-deep/60 px-3.5 py-2.5">
        <Stat
          label="Tu stake"
          value={`${satsLabel(b.stakeSats)}`}
          valueClass="text-ln-corona-bright"
        />
        <Stat
          label="Ganás ≈ 1v1"
          value={`${satsLabel(estPayout(b.stakeSats))}`}
          valueClass="text-ln-aurora-bright"
        />
        <div className="flex flex-col justify-center">
          <p className="ln-label">Depósito</p>
          <div className="mt-1">
            <DepositChip b={b} />
          </div>
        </div>
      </div>

      {b.payoutStatus === "paid" && b.payoutDestination ? (
        <p className="truncate text-[11px] text-ln-faint">
          💸 Premio {payoutKindLabel(b.payoutKind) ?? "enviado"} a{" "}
          <span className="font-mono text-ln-muted">{b.payoutDestination}</span>
        </p>
      ) : (
        <p className="text-[11px] text-ln-faint">
          Comisión 4% · el ganador se lleva el pozo neto.
        </p>
      )}

      <span className={`btn w-full ${cta.play ? "btn-aurora" : "btn-corona"}`}>
        {cta.label}
      </span>
    </Link>
  );
}

/**
 * Fila del historial en ancho completo con columnas: portada + juego, resultado,
 * fecha, destino del premio y monto. Reemplaza la fila antigua que dejaba casi
 * todo el ancho vacío entre el título y el monto.
 */
function HistoryRow({ b }: { b: Row }) {
  const tone = betTone(b.status, b.result);
  const o = outcomeMeta(b);
  const decided = tone === "won" || tone === "lost";
  const kind = payoutKindLabel(b.payoutKind);
  return (
    <li>
      <Link
        href={betHref(b)}
        className={`flex items-center gap-3 rounded-ln-md border border-ln-border border-l-[3px] bg-ln-card/60 px-4 py-3 transition-colors hover:bg-white/[.02] ${
          decided ? "" : "opacity-75"
        }`}
        style={{ borderLeftColor: toneAccent(tone) }}
      >
        <GameCover b={b} size="sm" />

        {/* Juego + resultado/destino (crece para llenar el ancho). */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-ln-text">
              {b.gameTitle}
            </p>
            <VersionBadge b={b} />
          </div>
          <p className="mt-0.5 truncate text-xs text-ln-faint">
            {o.label}
            {b.payoutStatus === "withdraw_pending" ? (
              <span className="font-medium text-ln-corona-bright">
                {" · "}Premio pendiente · abrir QR
              </span>
            ) : b.payoutStatus === "paid" && b.payoutDestination ? (
              <>
                {" · "}
                <span className="text-ln-muted">
                  {kind ? `${kind} ` : ""}
                  {b.payoutDestination}
                </span>
              </>
            ) : null}
          </p>
        </div>

        {/* Fecha: columna propia, oculta en pantallas chicas. */}
        <span className="hidden shrink-0 whitespace-nowrap text-xs text-ln-faint sm:block">
          {ago(b.createdAt)}
        </span>

        {/* Monto con signo/color. */}
        <span
          className={`w-28 shrink-0 text-right font-mono text-sm font-semibold ${o.amountClass}`}
        >
          {o.amount} sats
        </span>
      </Link>
    </li>
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
    // Neto de sats resueltos: premios cobrados − stakes perdidos.
    const netSats = settled.reduce((s, b) => {
      if (b.result === "won") return s + (b.payoutSats ?? b.stakeSats);
      if (b.result === "lost") return s - b.stakeSats;
      return s;
    }, 0);
    const winRate = settled.length
      ? Math.round((won / settled.length) * 100)
      : 0;
    return {
      escrowSats,
      activeCount: active.length,
      won,
      settledTotal: settled.length,
      winRate,
      netSats,
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
  const activeList = list.filter((b) => ACTIVE_BET_STATUSES.has(b.status));
  const historyList = list.filter((b) => !ACTIVE_BET_STATUSES.has(b.status));
  const shown = tab === "active" ? activeList : historyList;
  const netLabel =
    kpis.netSats > 0
      ? `+${satsLabel(kpis.netSats)}`
      : kpis.netSats < 0
        ? `−${satsLabel(Math.abs(kpis.netSats))}`
        : "0";

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

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="En juego ahora"
          value={satsLabel(kpis.escrowSats)}
          sub={`${kpis.activeCount} duelo${kpis.activeCount === 1 ? "" : "s"} en escrow`}
          accent="var(--ln-corona)"
        />
        <Kpi
          label="Efectividad"
          value={`${kpis.winRate}%`}
          sub={`${kpis.won} de ${kpis.settledTotal} ganadas`}
          accent="var(--ln-aurora)"
        />
        <Kpi
          label="Balance neto"
          value={netLabel}
          sub="sats resueltos"
          accent={
            kpis.netSats >= 0 ? "var(--ln-aurora)" : "var(--ln-danger)"
          }
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
            ["active", "Duelos activos", activeList.length],
            ["history", "Historial", historyList.length],
          ] as const
        ).map(([key, label, count]) => (
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
            <span className="ml-1.5 text-[11px] text-ln-faint">{count}</span>
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
            {shown.map((b) => (
              <HistoryRow key={b.id} b={b} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
