"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { storeFeeFromRevenueShare } from "./admin-types";

// ── KPI card ──

export function Kpi({
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
      className="rounded border border-line bg-panel p-4 pl-5"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
        {label}
      </p>
      <p className="mt-1 text-[25px] font-bold leading-none text-ink">{value}</p>
      {sub ? <p className="mt-1.5 text-[11.5px] text-muted">{sub}</p> : null}
    </div>
  );
}

// ── Revenue share per-game control ──

export function RevenueShareControl({
  gameId,
  revenueShare,
  onSaved,
  compact = false,
}: {
  gameId: string;
  revenueShare: number;
  onSaved: () => void | Promise<void>;
  compact?: boolean;
}) {
  const storeFeePct = storeFeeFromRevenueShare(revenueShare);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(storeFeePct));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeFeePct: draft }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "No se pudo guardar");
        return;
      }
      setEditing(false);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>
          Luna Negra {storeFeePct}% · proveedor {revenueShare}%
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft(String(storeFeePct));
            setError(null);
            setEditing(true);
          }}
          className="rounded border border-line px-2 py-0.5 text-[11px] text-muted transition hover:bg-white/5 hover:text-ink"
        >
          Editar
        </button>
      </span>
    );
  }

  return (
    <span className={compact ? "block max-w-[260px]" : "block"}>
      <span className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          max={100}
          required
          className="w-20 rounded border border-line bg-bg px-2 py-1 text-xs text-ink outline-none focus:ring-2 focus:ring-blue/30"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <span className="text-xs text-faint">% Luna Negra</span>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          Cancelar
        </Button>
      </span>
      {error ? <span className="mt-1 block text-[11px] text-[var(--lose)]">{error}</span> : null}
    </span>
  );
}

// ── Override por juego del corte de Luna Negra en APUESTAS ──

export function BetFeeControl({
  gameId,
  value,
  fallback,
  onSaved,
}: {
  gameId: string;
  value: number | null;
  fallback: number;
  onSaved: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betFeePct: draft.trim() === "" ? null : draft }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "No se pudo guardar");
        return;
      }
      setEditing(false);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>
          {value == null ? `${fallback}% (global)` : `${value}% (override)`}
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft(value == null ? "" : String(value));
            setError(null);
            setEditing(true);
          }}
          className="rounded border border-line px-2 py-0.5 text-[11px] text-muted transition hover:bg-white/5 hover:text-ink"
        >
          Editar
        </button>
      </span>
    );
  }

  return (
    <span className="block">
      <span className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          max={100}
          placeholder={`${fallback} (global)`}
          className="w-24 rounded border border-line bg-bg px-2 py-1 text-xs text-ink outline-none focus:ring-2 focus:ring-blue/30"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <span className="text-xs text-faint">% Luna Negra (vacío = global)</span>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          Cancelar
        </Button>
      </span>
      {error ? <span className="mt-1 block text-[11px] text-[var(--lose)]">{error}</span> : null}
    </span>
  );
}

// ── Toggle de estado beta ──

export function IsBetaControl({
  gameId,
  isBeta,
  onSaved,
}: {
  gameId: string;
  isBeta: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBeta: !isBeta }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "No se pudo cambiar estado beta");
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          className="accent-blue"
          checked={isBeta}
          onChange={toggle}
          disabled={saving}
        />
        <span className="text-[11px] font-medium text-ink">Beta</span>
      </label>
      {error ? <span className="text-[11px] text-[var(--lose)]">{error}</span> : null}
    </span>
  );
}
