"use client";

import { useState } from "react";
import { featureMeta, type IntegrationFeature } from "@/lib/integration-features";
import {
  INTEGRATION_COLUMNS,
  type CapabilityRow,
  type TwoZeroSide,
} from "@/lib/integration-2";
import {
  capMode,
  isMigratableCap,
  purchaseMode,
  PURCHASE_CAP,
  type CapMode,
  type PurchaseMode,
} from "@/lib/capability-mode";
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
    // Declaración manual de capacidades 2.0 no observables (login, presencia).
    manualCaps?: Record<string, boolean> | null;
    // Modo por capacidad intermedia: { [capKey]: "luna" | "nostr" }. "nostr" =
    // migrada a la interfaz Nostr (pata Luna apagada). Ver capability-mode.ts.
    capsMode?: Record<string, string> | null;
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

// ¿El proveedor declaró integrada la pata 2.0 (manual) de esta capacidad?
function declaredFor(
  row: CapabilityRow,
  manualCaps: Record<string, boolean> | null | undefined,
): boolean {
  const side = row.twoZero;
  if (!side || !side.manual) return false;
  return !!manualCaps?.[row.key];
}

// Un badge cuenta como "integrado" para el contador del juego si está vivo o
// declarado (no si es solo diseño / disponible-sin-uso / no declarado).
const LIVE1 = new Set<Level1>(["active", "stale", "configured"]);
const LIVE2 = new Set<Level2>(["active", "stale", "declared"]);

// ¿Esta capacidad está integrada por el juego? (misma definición que usa el
// contador "X/11 capacidades": alguna de sus patas cuenta como viva/declarada).
// Fuente única para el contador y para el acento visual de cada tarjeta.
function isRowLive(
  row: CapabilityRow,
  game: IntegrationView["games"][number],
  providerLevel: Record<string, PingInfo | null>,
  webhookConfigured: boolean,
  manualCaps: Record<string, boolean> | null | undefined,
): boolean {
  if (row.oneZero.length) {
    const ping1 = oneZeroPing(row, game, providerLevel);
    if (LIVE1.has(level1For(row, ping1, webhookConfigured))) return true;
  }
  const side = row.twoZero;
  if (side) {
    const ev = side.signal !== "none" ? game.nostr?.[side.signal] ?? null : null;
    if (LIVE2.has(level2For(side, ev, declaredFor(row, manualCaps)))) return true;
  }
  return false;
}

// Estado de la pata 2.0 desde la óptica de MIGRACIÓN (no solo "vive o no"):
//   "live"      → ya adoptada (en uso / declarada).
//   "adoptable" → implementada en la plataforma, sin adoptar por el juego (podés pasarte).
//   "design"    → todavía en spec, no se puede adoptar.
//   "none"      → esta capacidad no tiene equivalente 2.0 (solo-1.0).
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

// Semáforo por tarjeta pensado para quien está pasando de la 1.0 a la 2.0.
//   on2   → 2.0 adoptada.        migrate/adopt → 2.0 disponible/declarable sin adoptar.
//   on1   → integrada, sin 2.0 (solo-1.0).
//   off   → nada integrado.
type TileKind = "on2" | "migrate" | "adopt" | "on1" | "off";

const TILE_PRES: Record<
  TileKind,
  { ring: string; chip: string; dot: string; label: string }
> = {
  on2: {
    ring: "border-ln-aurora/45 bg-ln-aurora/[0.07]",
    chip: "bg-ln-aurora/15 text-ln-aurora",
    dot: "bg-ln-aurora",
    label: "En Nostr",
  },
  on1: {
    ring: "border-ln-aurora/45 bg-ln-aurora/[0.07]",
    chip: "bg-ln-aurora/15 text-ln-aurora",
    dot: "bg-ln-aurora",
    label: "Integrado",
  },
  migrate: {
    ring: "border-ln-corona/50 bg-ln-corona/[0.07]",
    chip: "bg-ln-corona/20 text-ln-corona",
    dot: "bg-ln-corona",
    label: "Pasá a Nostr",
  },
  adopt: {
    ring: "border-ln-corona/40 bg-ln-corona/[0.05]",
    chip: "bg-ln-corona/15 text-ln-corona",
    dot: "bg-ln-corona",
    label: "Nostr disponible",
  },
  off: {
    ring: "border-ln-border/50 bg-ln-card/15 opacity-70",
    chip: "bg-white/5 text-ln-faint",
    dot: "bg-white/25",
    label: "No integrado",
  },
};

// Deriva el estado de migración de una tarjeta cruzando su pata 1.0 (¿integrada?)
// con el estado de adopción de su pata 2.0.
function tileKind(leg1Live: boolean, s2: ReturnType<typeof leg2State>): TileKind {
  if (s2 === "live") return "on2";
  if (s2 === "adoptable") return leg1Live ? "migrate" : "adopt";
  // "design" (no declarable, p. ej. oráculo) o "none" (solo-1.0): no hay 2.0 que
  // adoptar hoy → solo importa si la 1.0 corre.
  return leg1Live ? "on1" : "off";
}

function Badge1({
  level,
  ping,
  probe,
  lunaOff,
  offLabel,
}: {
  level: Level1;
  ping: PingInfo | null;
  probe?: ProbeResult;
  // La pata Luna de esta capacidad está apagada (migrada a Nostr → 409, o compra
  // desactivada → acceso abierto). Se muestra tachada, sin tráfico ni probador.
  lunaOff?: boolean;
  offLabel?: string;
}) {
  const s = LEVEL1_STYLE[level];
  if (lunaOff) {
    return (
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 opacity-60">
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ln-faint line-through">
          Luna
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-ln-faint">
          {offLabel ?? "Apagada · migrado a Nostr"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ln-faint">
        Luna
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

// Segmento de dos opciones para cambiar por cuál riel corre una capacidad. Se usa
// para migrar Luna ⇄ Nostr (capacidades intermedias) y para activar/desactivar la
// verificación de compra. Editable solo para el proveedor dueño; el admin lo ve
// read-only (muestra el estado actual).
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

const LEG_OPTS: SegOpt[] = [
  {
    value: "luna",
    label: "Luna",
    active: "bg-ln-aurora/20 text-ln-aurora",
    title: "Volver a la interfaz Luna dependiente (REST)",
  },
  {
    value: "nostr",
    label: "Nostr",
    active: "bg-blue/20 text-blue",
    title: "Migrar a la interfaz Nostr (apaga la pata Luna: su endpoint REST devuelve 409)",
  },
];

const PURCHASE_OPTS: SegOpt[] = [
  {
    value: "on",
    label: "Verificar",
    active: "bg-ln-aurora/20 text-ln-aurora",
    title: "Requiere compra: verify valida el entitlement emitido por Luna",
  },
  {
    value: "off",
    label: "Acceso abierto",
    active: "bg-blue/20 text-blue",
    title: "Desactiva la verificación: el juego no requiere compra (verify responde valid:true para cualquiera)",
  },
];

function CapabilityTile({
  row,
  game,
  providerLevel,
  webhookConfigured,
  probe,
  nostrProbe,
  editable,
  manualCaps,
  capsMode,
  saving,
  onToggleManual,
  onSetLeg,
  onSetPurchase,
  savingLeg,
}: {
  row: CapabilityRow;
  game: IntegrationView["games"][number];
  providerLevel: Record<string, PingInfo | null>;
  webhookConfigured: boolean;
  probe?: Record<string, ProbeResult>;
  nostrProbe?: Record<string, NostrProbeResult>;
  editable?: boolean;
  manualCaps: Record<string, boolean> | null | undefined;
  capsMode: Record<string, string> | null | undefined;
  saving: boolean;
  onToggleManual: (key: string, next: boolean) => void;
  onSetLeg: (key: string, next: CapMode) => void;
  onSetPurchase: (next: PurchaseMode) => void;
  savingLeg: boolean;
}) {
  const ping1 = row.oneZero.length ? oneZeroPing(row, game, providerLevel) : null;
  const lvl1 = row.oneZero.length ? level1For(row, ping1, webhookConfigured) : null;
  // Anotación del probador: la del primer feature 1.0 que tenga resultado.
  const probeHit = row.oneZero.map((k) => probe?.[k]).find(Boolean);

  const side = row.twoZero;
  const ev =
    side && side.signal !== "none" ? game.nostr?.[side.signal] ?? null : null;
  // ¿Declaró integrada la pata 2.0? (login/presencia → manualCaps). Manda la
  // declaración cuando la capacidad no es observable por el probador.
  const declared = declaredFor(row, manualCaps);
  const lvl2 = side ? level2For(side, ev, declared) : null;

  // Capacidades declarables manualmente (el probador no las puede verificar):
  // login/presencia (side.manual) → Game.manualCaps[key].
  const isManualToggle = !!side?.manual;
  const toggleLabel =
    row.key === "identidad"
      ? "Declaro que integré el login Nostr (NIP-07/46)"
      : row.key === "presencia"
        ? "Declaro que uso la presencia en vivo (NIP-38)"
        : row.key === "salas"
          ? "Declaro que integré salas Nostr (NIP-29)"
          : row.key === "invitaciones"
            ? "Declaro que integré invitaciones Nostr (NIP-17)"
            : `Declaro que integré ${side?.label ?? "esta capacidad"}`;

  // ¿Capacidad migrable de la interfaz Luna a la Nostr? (identidad/marcador/
  // presencia/bets). Si está en "nostr", la pata Luna está apagada (endpoint 409).
  const migratable = isMigratableCap(row.key);
  const mode: CapMode = migratable ? capMode(capsMode, row.key) : "luna";
  // "Verificar compra": no se migra, se desactiva ("off" = acceso abierto).
  const isPurchase = row.key === PURCHASE_CAP;
  const pMode: PurchaseMode = isPurchase ? purchaseMode(capsMode) : "on";
  const purchaseOff = isPurchase && pMode === "off";

  // La pata Luna está apagada: migrada a Nostr (409) o compra desactivada (abierto).
  const lunaOff = (migratable && mode === "nostr") || purchaseOff;
  const offLabel = purchaseOff ? "Abierto · sin verificación" : undefined;

  // Estado de un vistazo desde la óptica de migración Luna → Nostr.
  const leg1Live = lvl1 != null && LIVE1.has(lvl1);
  const kind = tileKind(leg1Live, leg2State(side, ev, declared));
  const pres = TILE_PRES[kind];
  // Si la capacidad fue migrada a Nostr o la compra se desactivó, el chip lo dice sin
  // importar la telemetría (la pata Luna ya no cuenta).
  const offChipLabel = purchaseOff ? "Acceso abierto" : "Migrado a Nostr";
  const chipLabel = lunaOff ? offChipLabel : pres.label;
  const chipClass = lunaOff ? TILE_PRES.on2.chip : pres.chip;
  const chipDot = lunaOff ? TILE_PRES.on2.dot : pres.dot;
  const ringClass = lunaOff ? TILE_PRES.on2.ring : pres.ring;

  return (
    <div className={cn("rounded-ln-md border p-2.5 transition-colors", ringClass)}>
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-[12px] font-semibold leading-snug text-ln-text">{row.title}</p>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
            chipClass,
          )}
        >
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full", chipDot)} />
          {chipLabel}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {lvl1 ? (
          <Badge1 level={lvl1} ping={ping1} probe={probeHit} lunaOff={lunaOff} offLabel={offLabel} />
        ) : null}
        {side && lvl2 ? <Badge2 side={side} level={lvl2} ev={ev} /> : null}
        {side && nostrProbe?.[row.key] ? <Probe2Chip r={nostrProbe[row.key]} /> : null}
        {migratable ? (
          <SegToggle
            caption="Corre por"
            value={mode}
            opts={LEG_OPTS}
            editable={!!editable}
            saving={savingLeg}
            onSet={(next) => onSetLeg(row.key, next as CapMode)}
          />
        ) : null}
        {isPurchase ? (
          <SegToggle
            caption="Compra"
            value={pMode}
            opts={PURCHASE_OPTS}
            editable={!!editable}
            saving={savingLeg}
            onSet={(next) => onSetPurchase(next as PurchaseMode)}
          />
        ) : null}
        {editable && isManualToggle ? (
          <label className="mt-0.5 inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-ln-muted">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-ln-aurora"
              checked={declared}
              disabled={saving}
              onChange={(e) => onToggleManual(row.key, e.target.checked)}
            />
            {saving ? "Guardando…" : toggleLabel}
          </label>
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
  const [manualCaps, setManualCaps] = useState<Record<string, boolean>>(
    game.manualCaps ?? {},
  );
  const [capsMode, setCapsMode] = useState<Record<string, string>>(
    game.capsMode ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [savingLeg, setSavingLeg] = useState(false);
  // Declara/desmarca una capacidad 2.0 no observable (login, presencia).
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

  // Migra una capacidad intermedia a Luna o Nostr. En "nostr" la pata Luna (REST)
  // se apaga para este juego (su endpoint pasa a devolver 409).
  async function setLeg(key: string, next: CapMode) {
    const prev = capsMode[key] ?? "luna";
    if (prev === next) return;
    setCapsMode((m) => ({ ...m, [key]: next })); // optimista
    setSavingLeg(true);
    try {
      const r = await fetch(`/api/provider/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legMode: { key, value: next } }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setCapsMode((m) => ({ ...m, [key]: prev })); // revertir si falló
    } finally {
      setSavingLeg(false);
    }
  }

  // Activa/desactiva la verificación de compra. "off" = acceso abierto (el juego deja
  // de requerir compra; verify responde valid:true para cualquiera).
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

  // Capacidades "vivas" (en uso/declaradas) sobre el total del catálogo de 3 columnas.
  const rows = INTEGRATION_COLUMNS.flatMap((c) => c.rows);
  const live = rows.filter((row) =>
    isRowLive(row, game, providerLevel, webhookConfigured, manualCaps),
  ).length;

  // Progreso de migración: de las capacidades con camino 2.0, ¿cuántas ya están en Nostr?
  const with2 = rows.filter((r) => r.twoZero);
  const on2 = with2.filter((row) => {
    const side = row.twoZero!;
    const ev = side.signal !== "none" ? game.nostr?.[side.signal] ?? null : null;
    return leg2State(side, ev, declaredFor(row, manualCaps)) === "live";
  }).length;

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ln-text">{game.title}</p>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5" title="Capacidades con camino 2.0 ya migradas a Nostr">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-ln-aurora transition-all"
                style={{ width: `${Math.round((on2 / with2.length) * 100)}%` }}
              />
            </div>
            <span className="text-[11px] text-ln-muted">
              <span className="font-semibold text-ln-text">{on2}</span> de {with2.length} en 2.0
            </span>
          </div>
          <span className="text-[11px] text-ln-faint">· {live}/{rows.length} integradas</span>
        </div>
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
                  manualCaps={manualCaps}
                  capsMode={capsMode}
                  saving={saving}
                  onToggleManual={toggleManual}
                  onSetLeg={setLeg}
                  onSetPurchase={setPurchase}
                  savingLeg={savingLeg}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ln-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ln-aurora" />
          <strong className="font-semibold text-ln-aurora">En Nostr</strong> · ya en la interfaz independiente
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ln-corona" />
          <strong className="font-semibold text-ln-corona">Pasá a Nostr</strong> · corre en la interfaz Luna, falta migrar
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ln-aurora" />
          <strong className="font-semibold text-ln-aurora">Integrado</strong> · solo interfaz Luna, sin equivalente Nostr
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/25" />
          No integrado todavía
        </span>
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-ln-faint">
        Columna del medio = misma necesidad por dos caminos (interfaz Luna dependiente ⇆ interfaz independiente Nostr).
        La interfaz Nostr es experimental y no prometida; lo garantizado hoy es la interfaz Luna (§1–§8). El
        <em> «no probable»</em> es solo de la pata Nostr (login/presencia/diseño): no se puede
        verificar desde el server, no que falte la parte Luna.
      </p>
    </div>
  );
}

/**
 * Matriz de integración de un proveedor: una tarjeta por juego con el estado de
 * cada capacidad en las tres columnas (interfaz Luna · intermedio · interfaz Nostr),
 * más un botón para correr el probador en vivo (solo ejercita los endpoints REST de la interfaz Luna).
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
            Golpea los endpoints REST de la interfaz Luna y consulta los relays de la
            interfaz Nostr para ver qué responde/existe ahora mismo.
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
