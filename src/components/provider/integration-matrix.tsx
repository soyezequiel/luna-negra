"use client";

import { useState } from "react";
import {
  INTEGRATION_FEATURES,
  type FeatureMeta,
  type IntegrationFeature,
} from "@/lib/integration-features";
import { cn } from "@/lib/utils";

// ── Tipos del lado cliente (forma JSON que devuelven las rutas) ──
export type PingInfo = {
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
};
export type IntegrationView = {
  provider: { id: string; name: string; webhookConfigured: boolean; apiKeys: number };
  providerLevel: Record<string, PingInfo | null>;
  games: Array<{
    id: string;
    title: string;
    slug: string;
    status: string;
    features: Record<string, PingInfo | null>;
  }>;
};
export type ProbeResult = {
  feature: IntegrationFeature;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  detail: string;
  skipped: boolean;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  const mo = Math.floor(d / 30);
  return `hace ${mo} mes${mo > 1 ? "es" : ""}`;
}

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

type Level = "active" | "stale" | "configured" | "none";

function levelFor(
  feature: FeatureMeta,
  ping: PingInfo | null,
  webhookConfigured: boolean,
): Level {
  if (ping) {
    return Date.now() - new Date(ping.lastSeenAt).getTime() < RECENT_MS
      ? "active"
      : "stale";
  }
  if (feature.key === "webhooks" && webhookConfigured) return "configured";
  return "none";
}

const LEVEL_STYLE: Record<Level, { dot: string; chip: string; label: string }> = {
  active: { dot: "bg-ln-aurora", chip: "bg-ln-aurora/15 text-ln-aurora", label: "Integrado" },
  stale: { dot: "bg-ln-corona", chip: "bg-ln-corona/15 text-ln-corona", label: "Sin tráfico reciente" },
  configured: { dot: "bg-ln-corona", chip: "bg-ln-corona/15 text-ln-corona", label: "Configurado, sin entregas" },
  none: { dot: "bg-white/20", chip: "bg-white/10 text-ln-muted", label: "No integrado" },
};

function FeatureTile({
  feature,
  ping,
  webhookConfigured,
  probe,
}: {
  feature: FeatureMeta;
  ping: PingInfo | null;
  webhookConfigured: boolean;
  probe?: ProbeResult;
}) {
  const level = levelFor(feature, ping, webhookConfigured);
  const s = LEVEL_STYLE[level];
  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/40 p-3" title={feature.desc}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ln-text">
            <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", s.dot)} />
            <span className="truncate">{feature.title}</span>
          </p>
          <p className="mt-0.5 text-[10px] font-mono uppercase tracking-wide text-ln-faint">
            {feature.section}
            {feature.scope === "provider" ? " · proveedor" : ""}
            {feature.required ? " · mínimo" : ""}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold", s.chip)}>
          {s.label}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-ln-muted">
        {ping ? `Visto ${timeAgo(ping.lastSeenAt)}` : "Nunca recibido"}
      </p>

      {probe ? (
        <div
          className={cn(
            "mt-2 rounded-md px-2 py-1 text-[10.5px]",
            probe.skipped
              ? "bg-white/5 text-ln-faint"
              : probe.ok
                ? "bg-ln-aurora/10 text-ln-aurora"
                : "text-[var(--lose)]",
          )}
          style={
            !probe.skipped && !probe.ok
              ? { backgroundColor: "color-mix(in srgb, var(--lose) 12%, transparent)" }
              : undefined
          }
          title={probe.detail}
        >
          {probe.skipped ? "⏭ Omitido" : probe.ok ? "✓ Prueba OK" : "✗ Prueba falló"}
          {probe.status != null ? ` · ${probe.status}` : ""}
          {probe.latencyMs != null && !probe.skipped ? ` · ${probe.latencyMs}ms` : ""}
        </div>
      ) : null}
    </div>
  );
}

export function GameIntegrationCard({
  game,
  providerLevel,
  webhookConfigured,
  probe,
}: {
  game: IntegrationView["games"][number];
  providerLevel: Record<string, PingInfo | null>;
  webhookConfigured: boolean;
  probe?: Record<string, ProbeResult>;
}) {
  // Ping por feature: las de alcance "game" salen del juego; las "provider" del
  // nivel proveedor (aplican a todos sus juegos).
  function pingOf(f: FeatureMeta): PingInfo | null {
    return f.scope === "provider" ? providerLevel[f.key] ?? null : game.features[f.key] ?? null;
  }
  const integrated = INTEGRATION_FEATURES.filter(
    (f) => levelFor(f, pingOf(f), webhookConfigured) !== "none",
  ).length;

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ln-text">{game.title}</p>
        <span className="text-[11px] text-ln-muted">
          {integrated}/{INTEGRATION_FEATURES.length} interfaces
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {INTEGRATION_FEATURES.map((f) => (
          <FeatureTile
            key={f.key}
            feature={f}
            ping={pingOf(f)}
            webhookConfigured={webhookConfigured}
            probe={probe?.[f.key]}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Matriz de integración de un proveedor: una tarjeta por juego con el estado
 * (observado) de cada interfaz §1–§8, más un botón para correr el probador en
 * vivo. `onProbe` devuelve los resultados; el componente los muestra inline.
 */
export function IntegrationMatrix({
  view,
  onProbe,
  compact,
}: {
  view: IntegrationView;
  onProbe?: () => Promise<ProbeResult[]>;
  compact?: boolean;
}) {
  const [probe, setProbe] = useState<Record<string, ProbeResult> | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    if (!onProbe) return;
    setRunning(true);
    try {
      const results = await onProbe();
      setProbe(Object.fromEntries(results.map((r) => [r.feature, r])));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {onProbe ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="btn btn-outline"
          >
            {running ? "Probando…" : "Probar en vivo"}
          </button>
          <p className="text-[11px] text-ln-faint">
            Golpea los endpoints reales de Luna Negra para verificar que responden ahora.
          </p>
        </div>
      ) : null}

      {view.games.length === 0 ? (
        <p className="text-sm text-ln-faint">
          {compact ? "Sin juegos." : "Todavía no creaste juegos para mostrar su integración."}
        </p>
      ) : (
        view.games.map((g) => (
          <GameIntegrationCard
            key={g.id}
            game={g}
            providerLevel={view.providerLevel}
            webhookConfigured={view.provider.webhookConfigured}
            probe={probe ?? undefined}
          />
        ))
      )}
    </div>
  );
}
