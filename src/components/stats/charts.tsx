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
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface Series {
  key: string;
  label: string;
  color: string;
  format?: (n: number) => string;
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
