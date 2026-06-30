"use client";

/**
 * Wrappers temáticos sobre Recharts para las pantallas de estadísticas. Colorean
 * con los tokens Eclipse (var(--ln-…), --btc, --blue, --win) y muestran tooltips
 * en español. Cada serie define su color, etiqueta y formateador.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PlayerSample } from "@/lib/game-stats";

export interface Series {
  key: string;
  label: string;
  color: string;
  format?: (n: number) => string;
}

/** npub corto y legible para jugadores sin displayName. */
function shortNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}

const AXIS = "var(--ln-faint)";
const GRID = "var(--ln-border)";

// Forma mínima de lo que Recharts pasa al `content` del Tooltip (los tipos
// genéricos cambian entre versiones; tipamos solo lo que usamos).
interface TooltipPayloadItem {
  dataKey?: string | number;
  value?: number;
  color?: string;
}
interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  series: Series[];
  labelFormat: (s: string) => string;
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  labelFormat,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-ln-md border border-ln-border bg-ln-bg-deep/95 px-3 py-2 text-xs shadow-ln-card backdrop-blur">
      <p className="mb-1 font-medium text-ln-text">{labelFormat(String(label))}</p>
      {payload.map((p) => {
        const s = series.find((x) => x.key === p.dataKey);
        const v = typeof p.value === "number" ? p.value : 0;
        return (
          <p key={String(p.dataKey)} className="flex items-center gap-1.5 text-ln-muted">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: s?.color ?? p.color }}
            />
            {s?.label ?? p.dataKey}:{" "}
            <span className="font-mono text-ln-text">
              {s?.format ? s.format(v) : v.toLocaleString("es-AR")}
            </span>
          </p>
        );
      })}
    </div>
  );
}

interface TrendProps {
  data: object[];
  xKey: string;
  xFormat: (s: string) => string;
  series: Series[];
  height?: number;
}

/** Área apilada para series temporales suaves (ingresos, jugadores). */
export function AreaTrend({ data, xKey, xFormat, series, height = 220 }: TrendProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -6 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={xFormat}
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: GRID }}
          content={(p) => (
            <ChartTooltip
              {...(p as unknown as Partial<ChartTooltipProps>)}
              series={series}
              labelFormat={xFormat}
            />
          )}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#grad-${s.key})`}
            dot={false}
            activeDot={{ r: 3, fill: s.color }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Barras para conteos/volúmenes por bucket (apuestas, zaps). */
export function BarTrend({ data, xKey, xFormat, series, height = 220 }: TrendProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -6 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={xFormat}
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: "var(--ln-card)" }}
          content={(p) => (
            <ChartTooltip
              {...(p as unknown as Partial<ChartTooltipProps>)}
              series={series}
              labelFormat={xFormat}
            />
          )}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={s.color}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Curva de jugadores con "quién jugaba" en el tooltip ──

type PlayerRow = PlayerSample & { value: number };

function PlayersTooltip({
  active,
  payload,
  labelFormat,
  excludeOwner,
  color,
}: {
  active?: boolean;
  payload?: { payload?: PlayerRow }[];
  labelFormat: (s: string) => string;
  excludeOwner: boolean;
  color: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const MAX = 12;
  const shown = row.players.slice(0, MAX);
  const rest = row.players.length - shown.length;
  return (
    <div className="max-w-[260px] rounded-ln-md border border-ln-border bg-ln-bg-deep/95 px-3 py-2 text-xs shadow-ln-card backdrop-blur">
      <p className="mb-1 font-medium text-ln-text">{labelFormat(row.t)}</p>
      <p className="flex items-center gap-1.5 text-ln-muted">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        {excludeOwner ? "Jugadores (sin el dueño)" : "Jugadores"}:{" "}
        <span className="font-mono text-ln-text">{row.value}</span>
        {row.ownerCount > 0 ? (
          <span className="text-ln-faint">· {row.ownerCount} del dueño</span>
        ) : null}
      </p>
      {row.players.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-ln-border/60 pt-1.5">
          {shown.map((p) => (
            <li key={p.npub} className="flex items-center gap-1.5 text-ln-muted">
              <span className="truncate">{p.name ?? shortNpub(p.npub)}</span>
              {p.you ? (
                <span className="shrink-0 rounded-full bg-ln-luna/20 px-1.5 text-[10px] font-semibold text-ln-luna">
                  vos
                </span>
              ) : p.owner ? (
                <span className="shrink-0 rounded-full bg-ln-corona/20 px-1.5 text-[10px] font-semibold text-ln-corona">
                  dueño
                </span>
              ) : null}
            </li>
          ))}
          {rest > 0 ? <li className="text-ln-faint">+{rest} más</li> : null}
        </ul>
      ) : (
        <p className="mt-1 text-ln-faint">Sin nombres registrados.</p>
      )}
    </div>
  );
}

/**
 * Curva de jugadores concurrentes. El tooltip lista QUIÉN jugaba en ese punto
 * (marcando "vos" y "dueño"). Con `excludeOwner`, la curva resta las sesiones del
 * dueño del juego para no inflar las estadísticas con sus propias pruebas.
 */
export function PlayersAreaChart({
  data,
  xFormat,
  excludeOwner,
  height = 260,
}: {
  data: PlayerSample[];
  xFormat: (s: string) => string;
  excludeOwner: boolean;
  height?: number;
}) {
  const color = "var(--ln-aurora)";
  const rows: PlayerRow[] = data.map((s) => ({
    ...s,
    value: excludeOwner ? Math.max(0, s.count - s.ownerCount) : s.count,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 6, right: 10, bottom: 0, left: -6 }}>
        <defs>
          <linearGradient id="grad-players" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={xFormat}
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: GRID }}
          content={(p) => (
            <PlayersTooltip
              {...(p as unknown as { active?: boolean; payload?: { payload?: PlayerRow }[] })}
              labelFormat={xFormat}
              excludeOwner={excludeOwner}
              color={color}
            />
          )}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill="url(#grad-players)"
          dot={false}
          activeDot={{ r: 3, fill: color }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Aperturas como PUNTOS discretos (juegos que NO integraron presencia). Cada punto
 * es una apertura en su momento exacto: no se conectan ni se rellenan, porque sin
 * heartbeat no sabemos cuánto duró la sesión y dibujar un bloque fabricaría
 * concurrencia inexistente. Eje X temporal real (ms) para ubicar cada punto en su
 * instante. El tooltip lista QUIÉN abrió.
 */
export function PlayersScatterChart({
  data,
  xFormat,
  excludeOwner,
  height = 260,
}: {
  data: PlayerSample[];
  xFormat: (s: string) => string;
  excludeOwner: boolean;
  height?: number;
}) {
  const color = "var(--ln-aurora)";
  const rows = data
    .map((s) => ({
      ...s,
      tMs: Date.parse(s.t),
      value: excludeOwner ? Math.max(0, s.count - s.ownerCount) : s.count,
    }))
    // Con "excluir dueño", una apertura del propio dueño queda en 0 → no se grafica.
    .filter((r) => r.value > 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 6, right: 10, bottom: 0, left: -6 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="tMs"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(ms: number) => xFormat(new Date(ms).toISOString())}
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={36}
        />
        <YAxis
          dataKey="value"
          type="number"
          domain={[0, (max: number) => Math.max(2, max)]}
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: GRID, strokeDasharray: "3 3" }}
          content={(p) => (
            <PlayersTooltip
              {...(p as unknown as { active?: boolean; payload?: { payload?: PlayerRow }[] })}
              labelFormat={xFormat}
              excludeOwner={excludeOwner}
              color={color}
            />
          )}
        />
        <Scatter data={rows} fill={color} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
