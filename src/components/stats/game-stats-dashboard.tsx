"use client";

/**
 * Tablero de estadísticas de un juego (estilo SteamDB). Es agnóstico de la
 * fuente: recibe el JSON ya cargado (`buildGameStats`) y el control de rango; lo
 * usan tanto la pantalla de proveedor como la de admin.
 */

import { useState } from "react";
import { satsLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GameStats, StatsRange, Granularity } from "@/lib/game-stats";
import { AreaTrend, BarTrend, PlayersAreaChart, PlayersScatterChart } from "./charts";

const RANGES: { id: StatsRange; label: string }[] = [
  { id: "24h", label: "24 h" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
  { id: "all", label: "Todo" },
];

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
      <p className="mt-1 font-display text-[24px] font-extrabold leading-none text-ln-text">
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[11.5px] text-ln-muted">{sub}</p> : null}
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-[15px] font-bold text-ln-text">{title}</h3>
        {hint ? <span className="text-[11px] text-ln-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** Formatea una clave de bucket ("YYYY-MM-DD" o "YYYY-MM-DDTHH"). */
function bucketLabel(key: string, g: Granularity): string {
  if (g === "hour") {
    const [, time] = key.split("T");
    const [, m, d] = key.split("T")[0].split("-");
    return `${d}/${m} ${time}:00`;
  }
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}

/** Formatea un timestamp ISO de muestra de presencia. */
function sampleLabel(iso: string, g: Granularity): string {
  const dt = new Date(iso);
  if (g === "hour") {
    return dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  }
  return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function shortPubkey(pk: string): string {
  return pk.length > 12 ? `${pk.slice(0, 6)}…${pk.slice(-4)}` : pk;
}

export function GameStatsDashboard({
  stats,
  range,
  onRangeChange,
  loading,
  showHouse,
}: {
  stats: GameStats | null;
  range: StatsRange;
  onRangeChange: (r: StatsRange) => void;
  loading?: boolean;
  /** Admin: muestra las ganancias de Luna Negra (la casa). */
  showHouse?: boolean;
}) {
  const g = stats?.granularity ?? "day";
  const bx = (key: string) => bucketLabel(key, g);
  const [excludeOwner, setExcludeOwner] = useState(false);

  // ¿Alguna muestra incluye sesiones del dueño? Solo entonces ofrecemos excluirlas.
  const hasOwnerSessions =
    stats?.players.samples.some((s) => s.ownerCount > 0) ?? false;

  return (
    <div className="space-y-5">
      {/* Selector de rango */}
      <div className="flex w-fit gap-1 rounded-full border border-ln-border bg-ln-card/55 p-1.5">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onRangeChange(r.id)}
            className={cn(
              "rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors",
              range === r.id ? "text-[#1a1430]" : "text-ln-muted hover:text-ln-text",
            )}
            style={
              range === r.id
                ? { backgroundImage: "linear-gradient(120deg,#c2b5ff,#9d8cff)" }
                : undefined
            }
          >
            {r.label}
          </button>
        ))}
      </div>

      {!stats ? (
        <p className="text-sm text-ln-faint">
          {loading ? "Cargando…" : "Elegí un juego para ver sus estadísticas."}
        </p>
      ) : (
        <div className={cn("space-y-5", loading && "opacity-50")}>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <Kpi
              label="Ganancias por apuestas"
              value={satsLabel(stats.bets.devEarningsSats)}
              sub={`cobradas ${satsLabel(stats.bets.devSettledSats)} · por cobrar ${satsLabel(stats.bets.devPendingSats)}`}
              accent="var(--btc)"
            />
            <Kpi
              label="Ventas del juego"
              value={satsLabel(stats.revenue.providerShareSats)}
              sub={`${stats.revenue.salesCount} ventas · de ${satsLabel(stats.revenue.totalSats)} brutos`}
              accent="var(--win)"
            />
            <Kpi
              label="Zaps recibidos"
              value={satsLabel(stats.zaps.totalSats)}
              sub={`${stats.zaps.count} zaps`}
              accent="var(--ln-corona)"
            />
            <Kpi
              label="Volumen apostado"
              value={satsLabel(stats.bets.totalVolumeSats)}
              sub={`${stats.bets.activeCount} activas · ${stats.bets.settledCount} resueltas`}
              accent="var(--blue)"
            />
            {stats.players.source === "clicks" ? (
              <Kpi
                label="Aperturas en el período"
                value={String(stats.players.totalOpenings)}
                sub="veces que abrieron el juego (sin presencia integrada)"
                accent="var(--ln-aurora)"
              />
            ) : (
              <>
                <Kpi
                  label="Jugadores ahora"
                  value={String(stats.players.now)}
                  sub="presencia activa"
                  accent="var(--ln-aurora)"
                />
                <Kpi
                  label="Pico de jugadores"
                  value={String(stats.players.peak)}
                  sub="en el período"
                  accent="var(--ln-aurora)"
                />
              </>
            )}
          </div>

          {/* Ganancias de Luna Negra (la casa) — solo admin */}
          {showHouse && stats.house ? (
            <ChartCard
              title="Ganancias de Luna Negra"
              hint="solo admin · sats por período"
            >
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Kpi
                  label="Total de la casa"
                  value={satsLabel(stats.house.totalSats)}
                  sub="en el período"
                  accent="var(--ln-luna)"
                />
                <Kpi
                  label="Comisión de tienda"
                  value={satsLabel(stats.house.storeFeeSats)}
                  sub="sobre las ventas"
                  accent="var(--btc)"
                />
                <Kpi
                  label="Corte de apuestas"
                  value={satsLabel(stats.house.betFeeSats)}
                  sub="del pozo (casa)"
                  accent="var(--blue)"
                />
              </div>
              <AreaTrend
                data={stats.house.byBucket}
                xKey="t"
                xFormat={bx}
                series={[
                  {
                    key: "sats",
                    label: "Casa",
                    color: "var(--ln-luna)",
                    format: (n) => `${satsLabel(n)} sats`,
                  },
                ]}
              />
              <p className="mt-2 text-[11px] text-ln-faint">
                Comisión de tienda (ventas) + corte de la casa en apuestas. No
                incluye forfeits (premios no reclamados que quedan en la casa).
              </p>
            </ChartCard>
          ) : null}

          {/* Curva de jugadores (la estrella estilo SteamDB).
              · Con presencia integrada: curva CONTINUA (sabemos hasta cuándo siguió
                abierto el juego).
              · Sin presencia: PUNTOS de apertura en su momento exacto (no inventamos
                la duración de la sesión). */}
          <ChartCard
            title={
              stats.players.source === "clicks"
                ? "Aperturas del juego"
                : "Jugadores concurrentes"
            }
            hint={
              stats.players.source === "clicks"
                ? stats.players.sharedAcrossGames
                  ? "cada punto = una apertura · compartido entre los juegos del proveedor"
                  : "cada punto = una apertura (este juego no integró presencia)"
                : stats.players.sharedAcrossGames
                  ? "compartido entre los juegos del proveedor"
                  : "pasá el mouse para ver quién jugaba"
            }
          >
            {stats.players.samples.length === 0 ? (
              <p className="py-10 text-center text-sm text-ln-faint">
                {stats.players.source === "clicks"
                  ? "Todavía no hay aperturas registradas. Este juego no integró la presencia, así que mostramos un punto por cada vez que alguien abre el juego (no sabemos cuánto dura cada sesión sin presencia integrada)."
                  : "Todavía no hay muestras de presencia. La curva empieza a llenarse a medida que haya gente jugando (se muestrea cada pocos minutos)."}
              </p>
            ) : (
              <>
                {hasOwnerSessions ? (
                  <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-[12px] text-ln-muted">
                    <input
                      type="checkbox"
                      checked={excludeOwner}
                      onChange={(e) => setExcludeOwner(e.target.checked)}
                      className="accent-ln-luna"
                    />
                    Excluir las sesiones del dueño (no inflar con sus pruebas)
                  </label>
                ) : null}
                {stats.players.source === "clicks" ? (
                  <PlayersScatterChart
                    data={stats.players.samples}
                    xFormat={(iso) => sampleLabel(iso, g)}
                    excludeOwner={excludeOwner}
                    height={260}
                  />
                ) : (
                  <PlayersAreaChart
                    data={stats.players.samples}
                    xFormat={(iso) => sampleLabel(iso, g)}
                    excludeOwner={excludeOwner}
                    height={260}
                  />
                )}
                {stats.players.source === "clicks" ? (
                  <p className="mt-2 text-[11px] text-ln-faint">
                    Cada punto es una apertura en el momento exacto en que alguien abrió
                    el juego. Sin presencia integrada no sabemos cuánto duró la sesión,
                    así que no dibujamos una curva continua (sería inventar concurrencia).
                  </p>
                ) : null}
              </>
            )}
          </ChartCard>

          {/* Ventas del juego (solo compras; no incluye apuestas ni zaps) */}
          <ChartCard title="Ventas del juego" hint="ingresos por compras, sats por período">
            <AreaTrend
              data={stats.revenue.byBucket}
              xKey="t"
              xFormat={bx}
              series={[
                {
                  key: "share",
                  label: "Tu parte",
                  color: "var(--btc)",
                  format: (n) => `${satsLabel(n)} sats`,
                },
                {
                  key: "sats",
                  label: "Bruto",
                  color: "var(--blue)",
                  format: (n) => `${satsLabel(n)} sats`,
                },
              ]}
            />
            {stats.revenue.totalSats === 0 ? (
              <p className="mt-2 text-[11px] text-ln-faint">
                Sin ventas en el período (¿el juego es gratis?). Para juegos gratis
                tus ingresos vienen de <strong>Ganancias por apuestas</strong> y{" "}
                <strong>Zaps</strong>, abajo.
              </p>
            ) : null}
          </ChartCard>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Ganancias por apuestas (tu corte de dev, del ledger) */}
            <ChartCard title="Ganancias por apuestas" hint="tu corte de dev, sats por período">
              <BarTrend
                data={stats.bets.earningsByBucket}
                xKey="t"
                xFormat={bx}
                series={[
                  {
                    key: "sats",
                    label: "Ganancia",
                    color: "var(--btc)",
                    format: (n) => `${satsLabel(n)} sats`,
                  },
                ]}
              />
              <p className="mt-2 text-[11px] text-ln-faint">
                Total {satsLabel(stats.bets.devEarningsSats)} sats — cobradas{" "}
                {satsLabel(stats.bets.devSettledSats)} · por cobrar{" "}
                {satsLabel(stats.bets.devPendingSats)}
                {stats.bets.devFailedSats > 0
                  ? ` · falló ${satsLabel(stats.bets.devFailedSats)}`
                  : ""}
                . Volumen apostado {satsLabel(stats.bets.totalVolumeSats)} sats ·{" "}
                {stats.bets.totalCount} apuestas.
              </p>
            </ChartCard>

            {/* Zaps */}
            <ChartCard title="Zaps recibidos" hint="sats por período">
              <BarTrend
                data={stats.zaps.byBucket}
                xKey="t"
                xFormat={bx}
                series={[
                  {
                    key: "sats",
                    label: "Zaps",
                    color: "var(--ln-corona)",
                    format: (n) => `${satsLabel(n)} sats`,
                  },
                ]}
              />
              {stats.zaps.topZappers.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {stats.zaps.topZappers.slice(0, 5).map((z, i) => (
                    <li
                      key={z.pubkey}
                      className="flex items-center justify-between text-[12px]"
                    >
                      <span className="text-ln-muted">
                        {i + 1}. <code className="text-ln-faint">{shortPubkey(z.pubkey)}</code>
                      </span>
                      <span className="font-mono text-ln-corona-bright">
                        {satsLabel(z.sats)} sats
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </ChartCard>
          </div>

          {/* Estado de payouts */}
          <ChartCard title="Estado de payouts" hint="ventas del período">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["Pagados", stats.revenue.payout.paid, "var(--win)"],
                  ["En proceso", stats.revenue.payout.pending, "var(--btc)"],
                  ["Sin payout", stats.revenue.payout.none, "var(--ln-faint)"],
                  ["Fallidos", stats.revenue.payout.failed, "var(--lose)"],
                ] as const
              ).map(([label, value, color]) => (
                <div
                  key={label}
                  className="rounded-ln-md border border-ln-border bg-ln-bg-deep/40 px-3 py-2"
                >
                  <p className="text-[11px] text-ln-muted">{label}</p>
                  <p
                    className="mt-0.5 font-display text-[20px] font-bold"
                    style={{ color }}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
      )}
    </div>
  );
}
