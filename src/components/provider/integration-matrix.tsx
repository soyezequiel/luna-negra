"use client";

import { useState } from "react";
import { featureMeta, type IntegrationFeature } from "@/lib/integration-features";
import {
  INTEGRATION_COLUMNS,
  type CapabilityRow,
  type TwoZeroSide,
} from "@/lib/integration-2";
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
    supportsChallenges: boolean;
    features: Record<string, PingInfo | null>;
    // Señales de uso 2.0 (Nostr): scores | zaps | comments.
    nostr?: Record<string, PingInfo | null> | null;
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

// Resultado del probador 2.0 (relays Nostr), por capacidad (CapabilityRow.key).
// Forma espejo de la del server (src/lib/integration-probe-2.ts).
export type NostrProbeResult = {
  key: string;
  found: number;
  latencyMs: number | null;
  detail: string;
  skipped: boolean;
};

// Respuesta unificada del probador: 1.0 (endpoints REST, a nivel proveedor) +
// 2.0 (relays Nostr, por juego).
export type ProbeResponse = {
  results: ProbeResult[];
  nostr: Record<string, NostrProbeResult[]>;
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
const isRecent = (iso: string) => Date.now() - new Date(iso).getTime() < RECENT_MS;

function mergePings(...ps: Array<PingInfo | null | undefined>): PingInfo | null {
  let acc: PingInfo | null = null;
  for (const p of ps) {
    if (!p) continue;
    if (!acc) {
      acc = p;
      continue;
    }
    acc = {
      count: acc.count + p.count,
      firstSeenAt: acc.firstSeenAt < p.firstSeenAt ? acc.firstSeenAt : p.firstSeenAt,
      lastSeenAt: acc.lastSeenAt > p.lastSeenAt ? acc.lastSeenAt : p.lastSeenAt,
    };
  }
  return acc;
}

// ── Pata 1.0 (REST) ──
type Level1 = "active" | "stale" | "configured" | "none";

const LEVEL1_STYLE: Record<Level1, { dot: string; chip: string; label: string }> = {
  active: { dot: "bg-ln-aurora", chip: "bg-ln-aurora/15 text-ln-aurora", label: "Integrado" },
  stale: { dot: "bg-ln-corona", chip: "bg-ln-corona/15 text-ln-corona", label: "Sin tráfico reciente" },
  configured: { dot: "bg-ln-corona", chip: "bg-ln-corona/15 text-ln-corona", label: "Configurado" },
  none: { dot: "bg-white/20", chip: "bg-white/10 text-ln-muted", label: "No integrado" },
};

function oneZeroPing(
  row: CapabilityRow,
  game: IntegrationView["games"][number],
  providerLevel: Record<string, PingInfo | null>,
): PingInfo | null {
  return mergePings(
    ...row.oneZero.map((k) =>
      featureMeta(k).scope === "provider" ? providerLevel[k] : game.features[k],
    ),
  );
}

function level1For(
  row: CapabilityRow,
  ping: PingInfo | null,
  webhookConfigured: boolean,
): Level1 {
  if (ping) return isRecent(ping.lastSeenAt) ? "active" : "stale";
  if (row.oneZero.includes("webhooks") && webhookConfigured) return "configured";
  return "none";
}

// ── Pata 2.0 (Nostr) ──
type Level2 = "active" | "stale" | "declared" | "available" | "design" | "off";

const LEVEL2_STYLE: Record<Level2, { dot: string; chip: string; label: string }> = {
  active: { dot: "bg-ln-aurora", chip: "bg-ln-aurora/15 text-ln-aurora", label: "En uso" },
  stale: { dot: "bg-ln-corona", chip: "bg-ln-corona/15 text-ln-corona", label: "Sin uso reciente" },
  declared: { dot: "bg-blue", chip: "bg-blue/15 text-blue", label: "Declarado" },
  available: { dot: "bg-blue/40", chip: "bg-blue/10 text-blue", label: "Disponible" },
  design: { dot: "bg-white/15", chip: "bg-white/5 text-ln-faint", label: "Diseño" },
  off: { dot: "bg-white/15", chip: "bg-white/5 text-ln-faint", label: "No declarado" },
};

function level2For(
  side: TwoZeroSide,
  ev: PingInfo | null,
  supportsChallenges: boolean,
): Level2 {
  if (side.signal === "challenge") return supportsChallenges ? "declared" : "off";
  if (ev) return isRecent(ev.lastSeenAt) ? "active" : "stale";
  if (side.impl === "diseño") return "design";
  return "available"; // implementado, sin señal por juego (login, reseñas sin datos)
}

// Un badge cuenta como "integrado" para el contador del juego si está vivo o
// declarado (no si es solo diseño / disponible-sin-uso / no declarado).
const LIVE1 = new Set<Level1>(["active", "stale", "configured"]);
const LIVE2 = new Set<Level2>(["active", "stale", "declared"]);

function Badge1({ level, ping, probe }: { level: Level1; ping: PingInfo | null; probe?: ProbeResult }) {
  const s = LEVEL1_STYLE[level];
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ln-faint">
        1.0
      </span>
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", s.chip)}>
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", s.dot)} />
        {s.label}
      </span>
      <span className="text-[10px] text-ln-faint">{ping ? timeAgo(ping.lastSeenAt) : "nunca"}</span>
      {probe ? (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[9.5px]",
            probe.skipped ? "text-ln-faint" : probe.ok ? "text-ln-aurora" : "text-[var(--lose)]",
          )}
          title={probe.detail}
        >
          {probe.skipped ? "⏭" : probe.ok ? "✓" : "✗"}
          {probe.status != null ? ` ${probe.status}` : ""}
          {probe.latencyMs != null && !probe.skipped ? ` · ${probe.latencyMs}ms` : ""}
        </span>
      ) : null}
    </div>
  );
}

function Badge2({ side, level, ev }: { side: TwoZeroSide; level: Level2; ev: PingInfo | null }) {
  const s = LEVEL2_STYLE[level];
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1" title={side.desc}>
      <span className="inline-flex items-center gap-1 rounded-full bg-blue/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue">
        2.0
      </span>
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", s.chip)}>
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", s.dot)} />
        {s.label}
      </span>
      <span className="font-mono text-[9.5px] text-ln-faint">{side.label}</span>
      {ev ? <span className="text-[10px] text-ln-faint">{timeAgo(ev.lastSeenAt)}</span> : null}
    </div>
  );
}

function Probe2Chip({ r }: { r: NostrProbeResult }) {
  const style = r.skipped
    ? "bg-white/5 text-ln-faint"
    : r.found > 0
      ? "bg-ln-aurora/10 text-ln-aurora"
      : "bg-white/5 text-ln-muted";
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px]", style)}
      title={r.detail}
    >
      {r.skipped ? "⏭ no probable" : r.found > 0 ? `✓ ${r.found} en relays` : "0 en relays"}
      {r.latencyMs != null && !r.skipped ? ` · ${r.latencyMs}ms` : ""}
    </span>
  );
}

function CapabilityTile({
  row,
  game,
  providerLevel,
  webhookConfigured,
  probe,
  nostrProbe,
  editable,
  challenges,
  saving,
  onToggleChallenges,
}: {
  row: CapabilityRow;
  game: IntegrationView["games"][number];
  providerLevel: Record<string, PingInfo | null>;
  webhookConfigured: boolean;
  probe?: Record<string, ProbeResult>;
  nostrProbe?: Record<string, NostrProbeResult>;
  editable?: boolean;
  challenges: boolean;
  saving: boolean;
  onToggleChallenges: (next: boolean) => void;
}) {
  const ping1 = row.oneZero.length ? oneZeroPing(row, game, providerLevel) : null;
  const lvl1 = row.oneZero.length ? level1For(row, ping1, webhookConfigured) : null;
  // Anotación del probador: la del primer feature 1.0 que tenga resultado.
  const probeHit = row.oneZero.map((k) => probe?.[k]).find(Boolean);

  const side = row.twoZero;
  const ev = side && side.signal !== "challenge" && side.signal !== "none"
    ? game.nostr?.[side.signal] ?? null
    : null;
  const lvl2 = side ? level2For(side, ev, challenges) : null;
  // El toggle "declarar soporte de retos 1v1" vive en la fila "Invitaciones y
  // amigos" (su pata 2.0 es el reto NIP-17, gobernado por supportsChallenges).
  const isRetoToggle = row.key === "invitaciones";

  return (
    <div className="rounded-ln-md border border-ln-border bg-ln-card/40 p-2.5">
      <p className="text-[12px] font-semibold leading-snug text-ln-text">{row.title}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {lvl1 ? <Badge1 level={lvl1} ping={ping1} probe={probeHit} /> : null}
        {side && lvl2 ? <Badge2 side={side} level={lvl2} ev={ev} /> : null}
        {side && nostrProbe?.[row.key] ? <Probe2Chip r={nostrProbe[row.key]} /> : null}
        {isRetoToggle ? (
          editable ? (
            <label className="mt-0.5 inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-ln-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-ln-aurora"
                checked={challenges}
                disabled={saving}
                onChange={(e) => onToggleChallenges(e.target.checked)}
              />
              {saving ? "Guardando…" : "Declarar soporte de retos 1v1 (NIP-17)"}
            </label>
          ) : null
        ) : null}
      </div>
    </div>
  );
}

export function GameIntegrationCard({
  game,
  providerLevel,
  webhookConfigured,
  probe,
  nostrProbe,
  editable,
}: {
  game: IntegrationView["games"][number];
  providerLevel: Record<string, PingInfo | null>;
  webhookConfigured: boolean;
  probe?: Record<string, ProbeResult>;
  nostrProbe?: Record<string, NostrProbeResult>;
  /** Solo el proveedor dueño puede togglear capacidades; admin lo ve read-only. */
  editable?: boolean;
}) {
  const [challenges, setChallenges] = useState(game.supportsChallenges);
  const [saving, setSaving] = useState(false);
  async function toggleChallenges(next: boolean) {
    setChallenges(next); // optimista
    setSaving(true);
    try {
      const r = await fetch(`/api/provider/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supportsChallenges: next }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setChallenges(!next); // revertir si falló
    } finally {
      setSaving(false);
    }
  }

  // Capacidades "vivas" (en uso/declaradas) sobre el total del catálogo de 3 columnas.
  const rows = INTEGRATION_COLUMNS.flatMap((c) => c.rows);
  const live = rows.filter((row) => {
    const ping1 = row.oneZero.length ? oneZeroPing(row, game, providerLevel) : null;
    if (row.oneZero.length && LIVE1.has(level1For(row, ping1, webhookConfigured))) return true;
    const side = row.twoZero;
    if (side) {
      const ev =
        side.signal !== "challenge" && side.signal !== "none"
          ? game.nostr?.[side.signal] ?? null
          : null;
      if (LIVE2.has(level2For(side, ev, challenges))) return true;
    }
    return false;
  }).length;

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ln-text">{game.title}</p>
        <span className="text-[11px] text-ln-muted">
          {live}/{rows.length} capacidades
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {INTEGRATION_COLUMNS.map((col) => (
          <div key={col.id} className="rounded-ln-lg border border-ln-border/60 bg-ln-bg-deep/40 p-2.5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ln-text">{col.title}</p>
            <p className="mb-2 mt-0.5 text-[10px] leading-snug text-ln-faint">{col.subtitle}</p>
            <div className="flex flex-col gap-2">
              {col.rows.map((row) => (
                <CapabilityTile
                  key={row.key}
                  row={row}
                  game={game}
                  providerLevel={providerLevel}
                  webhookConfigured={webhookConfigured}
                  probe={probe}
                  nostrProbe={nostrProbe}
                  editable={editable}
                  challenges={challenges}
                  saving={saving}
                  onToggleChallenges={toggleChallenges}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10.5px] leading-snug text-ln-faint">
        Columna del medio = misma necesidad por dos caminos (REST 1.0 ⇆ eventos Nostr 2.0).
        La 2.0 es experimental y no prometida; lo garantizado hoy es la 1.0 (§1–§8). Los retos
        van cifrados E2E, así que su estado es la capacidad <em>declarada</em>, no tráfico observado.
      </p>
    </div>
  );
}

/**
 * Matriz de integración de un proveedor: una tarjeta por juego con el estado de
 * cada capacidad en las tres columnas (solo 1.0 · intermedio · solo 2.0), más un
 * botón para correr el probador en vivo (solo ejercita los endpoints REST 1.0).
 */
export function IntegrationMatrix({
  view,
  onProbe,
  compact,
  editable,
}: {
  view: IntegrationView;
  onProbe?: () => Promise<ProbeResponse>;
  compact?: boolean;
  /** Permite togglear capacidades por juego (solo el panel del proveedor dueño). */
  editable?: boolean;
}) {
  const [probe, setProbe] = useState<Record<string, ProbeResult> | null>(null);
  // Probe 2.0 indexado por juego → capacidad.
  const [nostrProbe, setNostrProbe] = useState<
    Record<string, Record<string, NostrProbeResult>> | null
  >(null);
  const [running, setRunning] = useState(false);

  async function run() {
    if (!onProbe) return;
    setRunning(true);
    try {
      const { results, nostr } = await onProbe();
      setProbe(Object.fromEntries(results.map((r) => [r.feature, r])));
      const byGame: Record<string, Record<string, NostrProbeResult>> = {};
      for (const [gameId, arr] of Object.entries(nostr ?? {})) {
        byGame[gameId] = Object.fromEntries(arr.map((r) => [r.key, r]));
      }
      setNostrProbe(byGame);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {onProbe ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={run} disabled={running} className="btn btn-outline">
            {running ? "Probando…" : "Probar en vivo"}
          </button>
          <p className="text-[11px] text-ln-faint">
            Golpea los endpoints REST 1.0 y consulta los relays Nostr 2.0 para ver qué
            responde/existe ahora mismo.
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
            nostrProbe={nostrProbe?.[g.id]}
            editable={editable}
          />
        ))
      )}
    </div>
  );
}
