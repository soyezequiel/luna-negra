"use client";

import { useState } from "react";
import {
  INTEGRATION_COLUMNS,
  type CapabilityRow,
  type TwoZeroSide,
} from "@/lib/integration-ngp";
import {
  purchaseMode,
  PURCHASE_CAP,
  type PurchaseMode,
} from "@/lib/capability-mode";
import { cn } from "@/lib/utils";

// ── Tipos del lado cliente (forma JSON que devuelven las rutas) ──
export type PingInfo = {
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
};
// Evidencia NGE de un juego (forma JSON de NgeEvidence, integration-telemetry).
export type NgeEvidenceJson = {
  issuedAt: string | null;
  rotatedAt: string | null;
  // RPC autenticados recibidos por el escrow (incluye get_info).
  rpc: PingInfo | null;
  // Apuestas creadas por el riel NGE.
  bets: PingInfo | null;
};

export type IntegrationView = {
  provider: { id: string; name: string; webhookConfigured: boolean; apiKeys: number };
  providerLevel: Record<string, PingInfo | null>;
  games: Array<{
    id: string;
    title: string;
    slug: string;
    status: string;
    // Coordenada NGP del juego (`30023:<pubkey>:<slug>`). Real si ya se publicó;
    // prevista (coordPending) si todavía no. La necesita el juego para el tag `a`.
    gameCoord?: string | null;
    coordPending?: boolean;
    // Declaración manual de capacidades NGP no observables (login, presencia).
    manualCaps?: Record<string, boolean> | null;
    // Modo por capacidad intermedia: { [capKey]: "luna" | "nostr" }. "nostr" =
    // migrada a NGP (pata Luna apagada). Ver capability-mode.ts.
    capsMode?: Record<string, string> | null;
    features: Record<string, PingInfo | null>;
    // Señales de uso NGP: scores | zaps | comments | betsV2 | presence | oracle | login.
    nostr?: Record<string, PingInfo | null> | null;
    // Evidencia NGE (credencial + RPC + apuestas).
    nge?: NgeEvidenceJson | null;
  }>;
};

// Resultado del probador NGP (relays Nostr), por capacidad (CapabilityRow.key).
// Forma espejo de la del server (src/lib/integration-probe-ngp.ts).
export type NostrProbeResult = {
  key: string;
  found: number;
  latencyMs: number | null;
  detail: string;
  skipped: boolean;
};

// Respuesta del probador: eventos NGP encontrados en relays, por juego.
export type ProbeResponse = {
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

// ── Pata NGP ──
type Level2 = "active" | "stale" | "declared" | "available" | "design";

const LEVEL2_STYLE: Record<Level2, { dot: string; chip: string; label: string }> = {
  active: { dot: "bg-ln-aurora", chip: "bg-ln-aurora/15 text-ln-aurora", label: "En uso" },
  stale: { dot: "bg-ln-corona", chip: "bg-ln-corona/15 text-ln-corona", label: "Sin uso reciente" },
  declared: { dot: "bg-blue", chip: "bg-blue/15 text-blue", label: "Declarado" },
  available: { dot: "bg-blue/40", chip: "bg-blue/10 text-blue", label: "Disponible" },
  design: { dot: "bg-white/15", chip: "bg-white/5 text-ln-faint", label: "Diseño" },
};

// `declared` = capacidad declarada manualmente por el proveedor (patas `manual`:
// login, presencia) desde Game.manualCaps[key]. Ver declaredFor().
function level2For(
  side: TwoZeroSide,
  ev: PingInfo | null,
  declared: boolean,
): Level2 {
  if (ev) return isRecent(ev.lastSeenAt) ? "active" : "stale";
  // Pata implementada pero no observable (login, presencia): manda la declaración.
  if (side.manual) return declared ? "declared" : "available";
  if (side.impl === "diseño") return "design";
  return "available"; // implementado, sin señal por juego (reseñas sin datos)
}

// ¿El proveedor declaró integrada la pata NGP (manual) de esta capacidad?
function declaredFor(
  row: CapabilityRow,
  manualCaps: Record<string, boolean> | null | undefined,
): boolean {
  const side = row.twoZero;
  if (!side || !side.manual) return false;
  return !!manualCaps?.[row.key];
}

// Texto del checkbox con el que el proveedor declara que integró una pata NGP no
// observable (login/presencia/invitaciones). Fuente única para la matriz Luna
// y la vista estándar Nostr.
function manualToggleLabel(row: CapabilityRow): string {
  switch (row.key) {
    case "identidad":
      return "Declaro que integré el login Nostr (NIP-07/46)";
    case "presencia":
      return "Declaro que uso la presencia en vivo (NIP-38)";
    case "invitaciones":
      return "Declaro que integré invitaciones Nostr (NIP-17)";
    default:
      return `Declaro que integré ${row.twoZero?.label ?? "esta capacidad"}`;
  }
}

// Un badge NGP cuenta como "vivo" (en uso / declarado) para el progreso del juego.
const LIVE2 = new Set<Level2>(["active", "stale", "declared"]);

// Estado de la pata NGP:
//   "live"      → ya adoptada (en uso / declarada).
//   "adoptable" → implementada en la plataforma, sin adoptar por el juego.
//   "design"    → todavía en spec, no se puede adoptar.
//   "none"      → sin equivalente NGP.
function leg2State(
  side: TwoZeroSide | null,
  ev: PingInfo | null,
  declared: boolean,
): "live" | "adoptable" | "design" | "none" {
  if (!side) return "none";
  const lvl = level2For(side, ev, declared);
  if (LIVE2.has(lvl)) return "live";
  if (lvl === "design") return "design";
  return "adoptable"; // available | off (p. ej. reto NIP-17 sin declarar)
}

function Badge2({ side, level, ev }: { side: TwoZeroSide; level: Level2; ev: PingInfo | null }) {
  const s = LEVEL2_STYLE[level];
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1" title={side.desc}>
      <span className="inline-flex items-center gap-1 rounded-full bg-blue/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue">
        Nostr
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

// Segmento de dos opciones para activar/desactivar la verificación de compra.
// Editable solo para el proveedor dueño; el admin lo ve read-only.
type SegOpt = { value: string; label: string; active: string; title: string };
function SegToggle({
  caption,
  value,
  opts,
  editable,
  saving,
  onSet,
}: {
  caption: string;
  value: string;
  opts: SegOpt[];
  editable: boolean;
  saving: boolean;
  onSet: (next: string) => void;
}) {
  return (
    <div className="mt-0.5 flex items-center gap-1.5">
      <span className="text-[9.5px] uppercase tracking-wide text-ln-faint">{caption}</span>
      <div className="inline-flex overflow-hidden rounded-full border border-ln-border/70">
        {opts.map((o) => {
          const isActive = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={!editable || saving || isActive}
              onClick={() => onSet(o.value)}
              className={cn(
                "px-2 py-0.5 text-[10px] font-semibold transition-colors",
                isActive ? o.active : "text-ln-faint",
                editable && !isActive && !saving ? "hover:bg-white/5 cursor-pointer" : "",
                !editable ? "cursor-default" : "",
              )}
              title={o.title}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {saving ? <span className="text-[9.5px] text-ln-faint">guardando…</span> : null}
    </div>
  );
}

const PURCHASE_OPTS: SegOpt[] = [
  {
    value: "on",
    label: "Verificar",
    active: "bg-ln-aurora/20 text-ln-aurora",
    title: "Requiere compra: el juego solo se lanza si el jugador lo posee",
  },
  {
    value: "off",
    label: "Acceso abierto",
    active: "bg-blue/20 text-blue",
    title: "Desactiva la verificación: el juego no requiere compra para lanzarse",
  },
];

// Acento del borde según el estado de la pata Nostr, para la vista estándar.
const NOSTR_RING: Record<Level2, string> = {
  active: "border-ln-aurora/45 bg-ln-aurora/[0.07]",
  stale: "border-ln-corona/45 bg-ln-corona/[0.06]",
  declared: "border-blue/45 bg-blue/[0.07]",
  available: "border-ln-border/60 bg-ln-card/15",
  design: "border-ln-border/40 bg-ln-card/10 opacity-70",
};

// Tarjeta de la vista estándar: SOLO la pata Nostr de una capacidad (interfaz
// NGP). Sin badge Luna ni control de migración; el proveedor solo
// declara las patas no observables (login/presencia/invitaciones).
function NostrCapabilityTile({
  row,
  game,
  nostrProbe,
  editable,
  manualCaps,
  saving,
  onToggleManual,
}: {
  row: CapabilityRow;
  game: IntegrationView["games"][number];
  nostrProbe?: Record<string, NostrProbeResult>;
  editable?: boolean;
  manualCaps: Record<string, boolean> | null | undefined;
  saving: boolean;
  onToggleManual: (key: string, next: boolean) => void;
}) {
  const side = row.twoZero!;
  const ev = side.signal !== "none" ? game.nostr?.[side.signal] ?? null : null;
  const declared = declaredFor(row, manualCaps);
  const lvl2 = level2For(side, ev, declared);
  const s = LEVEL2_STYLE[lvl2];
  const isManualToggle = !!side.manual;

  return (
    <div className={cn("rounded-ln-md border p-2.5 transition-colors", NOSTR_RING[lvl2])}>
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-[12px] font-semibold leading-snug text-ln-text">{row.title}</p>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
            s.chip,
          )}
        >
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full", s.dot)} />
          {s.label}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        <Badge2 side={side} level={lvl2} ev={ev} />
        {nostrProbe?.[row.key] ? <Probe2Chip r={nostrProbe[row.key]} /> : null}
        {editable && isManualToggle ? (
          <label className="mt-0.5 inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-ln-muted">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-ln-aurora"
              checked={declared}
              disabled={saving}
              onChange={(e) => onToggleManual(row.key, e.target.checked)}
            />
            {saving ? "Guardando…" : manualToggleLabel(row)}
          </label>
        ) : null}
      </div>
    </div>
  );
}

// ── NGE (Nostr Game Escrow) ──
// Veredicto de detección: hay RPC autenticado = detectado (get_info alcanza);
// credencial emitida sin RPC = esperando el handshake; nada = no configurado.
type NgeLevel = "active" | "stale" | "waiting" | "none";

function ngeLevelFor(nge: NgeEvidenceJson | null | undefined): NgeLevel {
  if (nge?.rpc) return isRecent(nge.rpc.lastSeenAt) ? "active" : "stale";
  if (nge?.issuedAt) return "waiting";
  return "none";
}

const NGE_STYLE: Record<NgeLevel, { dot: string; chip: string; label: string }> = {
  active: { dot: "bg-ln-aurora", chip: "bg-ln-aurora/15 text-ln-aurora", label: "Detectado" },
  stale: { dot: "bg-ln-corona", chip: "bg-ln-corona/15 text-ln-corona", label: "Sin RPC reciente" },
  waiting: { dot: "bg-blue", chip: "bg-blue/15 text-blue", label: "Esperando señal" },
  none: { dot: "bg-white/20", chip: "bg-white/10 text-ln-muted", label: "No configurado" },
};

const NGE_RING: Record<NgeLevel, string> = {
  active: "border-ln-aurora/45 bg-ln-aurora/[0.07]",
  stale: "border-ln-corona/45 bg-ln-corona/[0.06]",
  waiting: "border-blue/45 bg-blue/[0.07]",
  none: "border-ln-border/60 bg-ln-card/15",
};

/**
 * Panel de verificación NGE de un juego: credencial, RPC observados y apuestas
 * creadas por el riel. La detección es del lado del escrow: con pegar
 * NGE_CONNECTION y mandar `get_info`, Luna registra el RPC y esto pasa a
 * "Detectado" — por eso el botón «Buscar señal» (recarga la evidencia).
 */
function NgeStatusPanel({
  nge,
  editable,
  onRefresh,
}: {
  nge: NgeEvidenceJson | null | undefined;
  editable?: boolean;
  onRefresh?: () => Promise<void> | void;
}) {
  const [checking, setChecking] = useState(false);
  const level = ngeLevelFor(nge);
  const s = NGE_STYLE[level];

  async function check() {
    if (!onRefresh) return;
    setChecking(true);
    try {
      await onRefresh();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className={cn("rounded-ln-md border p-2.5 transition-colors", NGE_RING[level])}>
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-[12px] font-semibold leading-snug text-ln-text">
          Conexión NGE (RPC)
        </p>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
            s.chip,
          )}
        >
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full", s.dot)} />
          {s.label}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-1 text-[10.5px] text-ln-muted">
        {nge?.issuedAt ? (
          <span>
            Credencial emitida {timeAgo(nge.issuedAt)}
            {nge.rotatedAt ? ` · rotada ${timeAgo(nge.rotatedAt)}` : ""}
          </span>
        ) : (
          <span>Sin credencial emitida para este juego.</span>
        )}
        {nge?.rpc ? (
          <span>
            Último RPC recibido <strong className="text-ln-text">{timeAgo(nge.rpc.lastSeenAt)}</strong>
          </span>
        ) : nge?.issuedAt ? (
          <span>Todavía no recibimos ningún RPC de tu game server.</span>
        ) : null}
        {nge?.bets ? (
          <span>
            {nge.bets.count} apuesta(s) creadas por NGE · última {timeAgo(nge.bets.lastSeenAt)}
          </span>
        ) : null}
      </div>

      {editable && level === "none" ? (
        <p className="mt-2 text-[10.5px] leading-snug text-ln-faint">
          Emití la credencial (<code>NGE_CONNECTION</code>) en el{" "}
          <a href="/provider" className="text-blue hover:underline">
            panel de proveedor → Integración
          </a>{" "}
          y pegala en tu game server.
        </p>
      ) : null}

      {level === "waiting" || level === "stale" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {onRefresh ? (
            <button
              type="button"
              onClick={check}
              disabled={checking}
              className="rounded-full border border-ln-border/70 px-2.5 py-0.5 text-[10px] font-semibold text-blue hover:bg-white/5 disabled:opacity-60"
            >
              {checking ? "Buscando…" : "Buscar señal"}
            </button>
          ) : null}
          <p className="text-[10.5px] leading-snug text-ln-faint">
            Con la credencial pegada, mandá <code>get_info</code> desde tu server:
            cualquier RPC autenticado cuenta como detección.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function GameIntegrationCard({
  game,
  nostrProbe,
  editable,
  onRefresh,
}: {
  game: IntegrationView["games"][number];
  nostrProbe?: Record<string, NostrProbeResult>;
  /** Solo el proveedor dueño puede togglear capacidades; admin lo ve read-only. */
  editable?: boolean;
  /** Recarga la vista (evidencia fresca); lo usa «Buscar señal» del panel NGE. */
  onRefresh?: () => Promise<void> | void;
}) {
  const [manualCaps, setManualCaps] = useState<Record<string, boolean>>(
    game.manualCaps ?? {},
  );
  const [capsMode, setCapsMode] = useState<Record<string, string>>(
    game.capsMode ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [savingLeg, setSavingLeg] = useState(false);
  // Declara/desmarca una capacidad NGP no observable (login, presencia).
  async function toggleManual(key: string, next: boolean) {
    setManualCaps((m) => ({ ...m, [key]: next })); // optimista
    setSaving(true);
    try {
      const r = await fetch(`/api/provider/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualCap: { key, value: next } }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setManualCaps((m) => ({ ...m, [key]: !next })); // revertir si falló
    } finally {
      setSaving(false);
    }
  }

  // Activa/desactiva la verificación de compra. "off" = acceso abierto: el juego
  // deja de requerir compra para lanzarse. Es un ajuste de la tienda, no de NGP.
  async function setPurchase(next: PurchaseMode) {
    const prev = (capsMode[PURCHASE_CAP] as PurchaseMode) ?? "on";
    if (prev === next) return;
    setCapsMode((m) => ({ ...m, [PURCHASE_CAP]: next })); // optimista
    setSavingLeg(true);
    try {
      const r = await fetch(`/api/provider/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseMode: next }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setCapsMode((m) => ({ ...m, [PURCHASE_CAP]: prev })); // revertir si falló
    } finally {
      setSavingLeg(false);
    }
  }

  const pMode: PurchaseMode = purchaseMode(capsMode);

  // ── Vista estándar (Nostr Games Protocol (NGP)) ──
  // Capacidades con pata Nostr. "Apuestas y escrow" va aparte como opcional.
  const rows = INTEGRATION_COLUMNS.flatMap((c) => c.rows);
  const nostrRows = rows.filter((r) => r.twoZero);
  const betsRow = nostrRows.find((r) => r.key === "bets") ?? null;
  const coreNostrRows = nostrRows.filter((r) => r.key !== "bets");
  const nostrLive = nostrRows.filter((row) => {
    const side = row.twoZero!;
    const ev = side.signal !== "none" ? game.nostr?.[side.signal] ?? null : null;
    return leg2State(side, ev, declaredFor(row, manualCaps)) === "live";
  }).length;

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ln-text">{game.title}</p>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5" title="Capacidades de Nostr Games Protocol (NGP) activas">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-ln-aurora transition-all"
                style={{ width: `${Math.round((nostrLive / nostrRows.length) * 100)}%` }}
              />
            </div>
            <span className="text-[11px] text-ln-muted">
              <span className="font-semibold text-ln-text">NGP {nostrLive}</span> de {nostrRows.length}
            </span>
          </div>
          {(() => {
            const s = NGE_STYLE[ngeLevelFor(game.nge)];
            return (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  s.chip,
                )}
                title="Estado de la conexión NGE (apuestas y escrow por RPC)"
              >
                <span className={cn("inline-block h-1.5 w-1.5 rounded-full", s.dot)} />
                NGE · {s.label}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Verificación de compra: ajuste de la tienda (no NGP). El dueño lo edita;
          el admin lo ve read-only. "off" = acceso abierto (no requiere compra). */}
      <div className="mt-3">
        <SegToggle
          caption="Verificar compra"
          value={pMode}
          opts={PURCHASE_OPTS}
          editable={!!editable}
          saving={savingLeg}
          onSet={(next) => setPurchase(next as PurchaseMode)}
        />
      </div>

      {/* ── Nostr Games Protocol (NGP) + apuestas (opcional) ── */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {coreNostrRows.map((row) => (
          <NostrCapabilityTile
            key={row.key}
            row={row}
            game={game}
            nostrProbe={nostrProbe}
            editable={editable}
            manualCaps={manualCaps}
            saving={saving}
            onToggleManual={toggleManual}
          />
        ))}
      </div>

      <div className="mt-3 rounded-ln-lg border border-ln-border/60 bg-ln-bg-deep/40 p-2.5">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-blue/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue">
            Opcional
          </span>
          <span className="text-[11px] font-semibold text-ln-text">
            NGE · Apuestas y escrow
          </span>
          <span className="font-mono text-[9.5px] text-ln-faint">NGE_CONNECTION</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <NgeStatusPanel nge={game.nge} editable={editable} onRefresh={onRefresh} />
          {betsRow ? (
            <NostrCapabilityTile
              row={betsRow}
              game={game}
              nostrProbe={nostrProbe}
              editable={editable}
              manualCaps={manualCaps}
              saving={saving}
              onToggleManual={toggleManual}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ln-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ln-aurora" />
          <strong className="font-semibold text-ln-aurora">En uso</strong> · evento observado en relays
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue" />
          <strong className="font-semibold text-blue">Declarado</strong> · lo integraste (no observable)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue/40" />
          Disponible / en diseño
        </span>
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-ln-faint">
        Con evidencia se considera detectado: eventos NGP observados en relays o en la DB
        (marcador, reseñas, zaps), presencia vista por el probador (queda persistida), login
        NIP-07/46 <em>inferido</em> del marcador firmado por el jugador, y NGE detectado con
        cualquier RPC autenticado (un <code>get_info</code> alcanza). Lo cifrado E2E o sin
        rastro (invitaciones NIP-17, login sin marcador) se declara manualmente.
      </p>
    </div>
  );
}

/**
 * Matriz de integración de un proveedor: una tarjeta por juego con el estado de
 * cada capacidad de NGP y NGE, más un botón para correr el probador en vivo
 * (consulta los relays de Nostr).
 */
export function IntegrationMatrix({
  view,
  onProbe,
  onRefresh,
  compact,
  editable,
}: {
  view: IntegrationView;
  onProbe?: () => Promise<ProbeResponse>;
  /** Recarga la vista con evidencia fresca (botón «Buscar señal» de NGE). */
  onRefresh?: () => Promise<void> | void;
  compact?: boolean;
  /** Permite togglear capacidades por juego (solo el panel del proveedor dueño). */
  editable?: boolean;
}) {
  // Probe NGP indexado por juego → capacidad.
  const [nostrProbe, setNostrProbe] = useState<
    Record<string, Record<string, NostrProbeResult>> | null
  >(null);
  const [running, setRunning] = useState(false);

  async function run() {
    if (!onProbe) return;
    setRunning(true);
    try {
      const { nostr } = await onProbe();
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
            {running ? "Verificando…" : "Verificar ahora"}
          </button>
          <p className="text-[11px] text-ln-faint">
            Consulta los relays de NGP y recarga la evidencia (lo encontrado queda persistido como detección).
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
            nostrProbe={nostrProbe?.[g.id]}
            editable={editable}
            onRefresh={onRefresh}
          />
        ))
      )}
    </div>
  );
}
