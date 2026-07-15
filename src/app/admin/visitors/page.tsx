"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { AreaTrend } from "@/components/stats/charts";

type Granularity = "day" | "week" | "month";
type GrowthPoint = { t: string; new: number; total: number };
type Growth = { granularity: Granularity; points: GrowthPoint[] };
type Concurrent = {
  onlineNow: number;
  peak: number;
  points: { t: string; count: number }[];
};

type Visitor = {
  npub: string;
  displayName: string | null;
  avatarUrl: string | null;
  lastSeen: string;
  createdAt: string;
  lastPlayedAt: string | null;
};
type Summary = {
  total: number;
  active1d: number;
  active7d: number;
  active30d: number;
};
type Distribution = {
  today: number;
  week: number;
  month: number;
  older: number;
};
type Payload = {
  summary: Summary;
  concurrent: Concurrent;
  growth: Growth;
  distribution: Distribution;
  visitors: Visitor[];
};

function shortNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}

/** unix segundos para timeAgo, desde un ISO. */
function unix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

const GRANULARITY_LABEL: Record<Granularity, string> = {
  day: "por día",
  week: "por semana",
  month: "por mes",
};

/** Etiqueta del eje X de la curva de concurrentes (ISO horario). */
function concurrentLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
  });
}

/** Etiqueta del eje X de la curva de crecimiento ("YYYY-MM-DD"). */
function growthLabel(key: string, g: Granularity): string {
  const d = new Date(`${key}T00:00:00Z`);
  if (g === "month") {
    return d.toLocaleDateString("es-AR", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  }
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
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
      className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4 pl-5"
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

// Barra de distribución de actividad (último login). Segmentos excluyentes.
const SEGMENTS: { key: keyof Distribution; label: string; color: string }[] = [
  { key: "today", label: "Hoy", color: "var(--ln-aurora)" },
  { key: "week", label: "Esta semana", color: "var(--blue)" },
  { key: "month", label: "Este mes", color: "var(--btc)" },
  { key: "older", label: "Inactivos (+30 d)", color: "var(--ln-faint)" },
];

function ActivityBar({ dist }: { dist: Distribution }) {
  const total = SEGMENTS.reduce((n, s) => n + dist[s.key], 0);
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded-full border border-ln-border bg-ln-bg-deep/40">
        {total === 0 ? (
          <div className="flex w-full items-center justify-center text-[11px] text-ln-faint">
            Sin usuarios todavía
          </div>
        ) : (
          SEGMENTS.map((s) => {
            const v = dist[s.key];
            if (v === 0) return null;
            return (
              <div
                key={s.key}
                style={{ width: `${(v / total) * 100}%`, background: s.color }}
                title={`${s.label}: ${v}`}
              />
            );
          })
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {SEGMENTS.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[12px] text-ln-muted">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}{" "}
            <span className="font-mono text-ln-text">{dist[s.key]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Avatar({ v }: { v: Visitor }) {
  const initial = (v.displayName ?? v.npub).replace(/^npub1?/, "").charAt(0).toUpperCase();
  if (v.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={v.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="h-9 w-9 shrink-0 rounded-full border border-ln-border object-cover"
      />
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ln-border bg-ln-card text-[13px] font-bold text-ln-muted">
      {initial}
    </div>
  );
}

export default function AdminVisitorsPage() {
  const { user, login, loading } = useSession();
  const [data, setData] = useState<Payload | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/visitors");
    if (r.status === 403) {
      setForbidden(true);
      setLoaded(true);
      return;
    }
    const d = await r.json().catch(() => null);
    setForbidden(false);
    setData(d);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void load();
  }, [user, load]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Quiénes entran (admin)</h1>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>
            Iniciar sesión
          </Button>
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

  return (
    <div className="mx-auto max-w-[1040px] px-[22px] py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Quiénes entran
          </h1>
          <p className="mt-1 text-sm text-ln-muted">
            Usuarios ordenados por su última entrada a la tienda (cada login
            actualiza su actividad).
          </p>
        </div>
        <Link href="/admin" className="btn btn-ghost shrink-0 self-start">
          Volver al panel
        </Link>
      </div>

      {!loaded ? (
        <p className="mt-6 text-sm text-ln-faint">Cargando…</p>
      ) : !data ? (
        <p className="mt-6 text-sm text-ln-faint">No se pudieron cargar los datos.</p>
      ) : (
        <>
          {/* KPIs */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Activos hoy"
              value={String(data.summary.active1d)}
              sub="entraron en las últimas 24 h"
              accent="var(--ln-aurora)"
            />
            <Kpi
              label="Activos 7 días"
              value={String(data.summary.active7d)}
              sub="entraron esta semana"
              accent="var(--blue)"
            />
            <Kpi
              label="Activos 30 días"
              value={String(data.summary.active30d)}
              sub="entraron este mes"
              accent="var(--btc)"
            />
            <Kpi
              label="Usuarios totales"
              value={String(data.summary.total)}
              sub="registrados en total"
              accent="var(--ln-luna)"
            />
          </div>

          {/* Curva de usuarios concurrentes online (tracking en vivo) */}
          <div className="mt-5 rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-display text-[15px] font-bold text-ln-text">
                Usuarios concurrentes
              </h3>
              <span className="text-[11px] text-ln-faint">
                online en la tienda · pico por hora · 7 días
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Kpi
                label="Online ahora"
                value={String(data.concurrent.onlineNow)}
                sub="con la tienda abierta"
                accent="var(--ln-aurora)"
              />
              <Kpi
                label="Pico (7 días)"
                value={String(data.concurrent.peak)}
                sub="máximo concurrente"
                accent="var(--blue)"
              />
            </div>
            {data.concurrent.points.length === 0 ? (
              <p className="py-10 text-center text-sm text-ln-faint">
                Todavía no hay muestras de concurrencia. La curva se llena de aquí
                en más: se muestrea cada minuto a quienes tienen la tienda abierta
                y logueada (no hay forma de reconstruir la concurrencia pasada).
              </p>
            ) : (
              <>
                <AreaTrend
                  data={data.concurrent.points}
                  xKey="t"
                  xFormat={concurrentLabel}
                  series={[
                    {
                      key: "count",
                      label: "Online",
                      color: "var(--ln-aurora)",
                      format: (n) => n.toLocaleString("es-AR"),
                    },
                  ]}
                  height={240}
                />
                <p className="mt-2 text-[11px] text-ln-faint">
                  Pico de usuarios con la tienda abierta en cada hora. Cuenta
                  usuarios logueados; no incluye visitantes anónimos.
                </p>
              </>
            )}
          </div>

          {/* Curva de crecimiento de usuarios (altas acumuladas) */}
          <div className="mt-5 rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-display text-[15px] font-bold text-ln-text">
                Aumento de usuarios
              </h3>
              <span className="text-[11px] text-ln-faint">
                altas acumuladas · {GRANULARITY_LABEL[data.growth.granularity]}
              </span>
            </div>
            {data.growth.points.length === 0 ? (
              <p className="py-10 text-center text-sm text-ln-faint">
                Todavía no hay usuarios registrados.
              </p>
            ) : (
              <>
                <AreaTrend
                  data={data.growth.points}
                  xKey="t"
                  xFormat={(k) => growthLabel(k, data.growth.granularity)}
                  series={[
                    {
                      key: "total",
                      label: "Usuarios totales",
                      color: "var(--ln-luna)",
                      format: (n) => n.toLocaleString("es-AR"),
                    },
                  ]}
                  height={240}
                />
                <p className="mt-2 text-[11px] text-ln-faint">
                  Total acumulado de cuentas registradas a lo largo del tiempo. La
                  granularidad se ajusta sola según la antigüedad de la tienda.
                </p>
              </>
            )}
          </div>

          {/* Gráfica de distribución de actividad */}
          <div className="mt-5 rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-display text-[15px] font-bold text-ln-text">
                Distribución de actividad
              </h3>
              <span className="text-[11px] text-ln-faint">por última entrada</span>
            </div>
            <ActivityBar dist={data.distribution} />
          </div>

          {/* Lista de quiénes entraron */}
          <div className="mt-5 rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-display text-[15px] font-bold text-ln-text">
                Últimos en entrar
              </h3>
              <span className="text-[11px] text-ln-faint">
                {data.visitors.length === 100 ? "top 100" : `${data.visitors.length} usuarios`}
              </span>
            </div>
            {data.visitors.length === 0 ? (
              <p className="py-8 text-center text-sm text-ln-faint">
                Todavía no entró nadie.
              </p>
            ) : (
              <ul className="divide-y divide-ln-border/60">
                {data.visitors.map((v) => (
                  <li key={v.npub} className="flex items-center gap-3 py-2.5">
                    <Avatar v={v} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ln-text">
                        {v.displayName ?? shortNpub(v.npub)}
                      </p>
                      <p className="truncate font-mono text-[11px] text-ln-faint">
                        {shortNpub(v.npub)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[12px] text-ln-muted">{timeAgo(unix(v.lastSeen))}</p>
                      <p className="text-[11px] text-ln-faint">
                        registrado {timeAgo(unix(v.createdAt))}
                        {v.lastPlayedAt ? (
                          <span
                            className={cn(
                              "ml-1.5 rounded-full bg-ln-aurora/15 px-1.5 text-[10px] font-semibold text-ln-aurora",
                            )}
                            title={`Última vez que jugó: ${new Date(v.lastPlayedAt).toLocaleString("es-AR")}`}
                          >
                            jugó {timeAgo(unix(v.lastPlayedAt))}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
