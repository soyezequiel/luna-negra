"use client";

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { categoryLabel } from "@/lib/categories";
import {
  IntegrationMatrix,
  type IntegrationView,
  type ProbeResponse,
} from "@/components/provider/integration-matrix";

type Row = {
  id: string;
  title: string;
  slug: string;
  priceSats: number;
  provider: { name: string };
};
// Juego en revisión: la API ya devuelve el objeto Game completo. Lo tipamos
// entero para poder mostrar todos los datos antes de aprobar/rechazar.
type ReviewGame = Row & {
  description: string;
  categories: string[];
  revenueShare: number;
  betFeePct: number | null; // override del corte de apuestas de la casa; null = global
  gameUrl: string | null;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
  screenshots: string; // JSON array de URLs
  createdAt: string;
  isBeta: boolean;
};
type DraftGame = Omit<Row, "provider"> & {
  description: string;
  categories: string[];
  gameUrl: string | null;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
  createdAt: string;
  provider: {
    name: string;
    owner: { displayName: string | null; npub: string };
  };
};
type CatalogRow = Row & {
  owners: number;
  revenueShare: number;
  betFeePct: number | null;
  isBeta: boolean;
};
type Payout = {
  id: string;
  gameTitle: string;
  providerName: string;
  lightningAddress: string | null;
  share: number;
  payoutStatus: string;
};

type BetPayout = {
  npub: string;
  payoutSats: number;
  payoutStatus: string;
  payoutDestination: string | null;
  payoutKind: string | null;
};
type BetRow = {
  id: string;
  version: 1 | 2;
  gameTitle: string;
  status: string;
  stakeSats: number;
  paid: number;
  total: number;
  payouts: BetPayout[];
};
type EconomySettings = {
  storeFeePct: number;
  providerRevenueShare: number;
  betFeePct: number;
  betDevFeeMaxPct: number;
  updatedAt: string | null;
  configured: boolean;
};
type TreasurySettings = {
  minSats: number;
  maxSats: number;
  updatedAt: string | null;
  configured: boolean;
};
type TreasuryInfo = {
  settings: TreasurySettings;
  balanceSats: number | null;
  lightningConfigured: boolean;
  address: string | null;
};

const PAYOUT_LABEL: Record<string, string> = {
  pending: "En proceso",
  failed: "Falló",
  skipped: "Sin dirección",
};

const ADMIN_DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeZone: "America/Argentina/Buenos_Aires",
});

function shortNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}

function draftAge(createdAt: string): string {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000),
  );
  if (days === 0) return "hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
}

function missingDraftFields(game: DraftGame): string[] {
  const missing: string[] = [];
  if (!game.gameUrl?.trim()) missing.push("URL del juego");
  if (!game.description.trim()) missing.push("descripción");
  if (game.categories.length === 0) missing.push("categoría");
  if (!game.coverUrl && !game.horizontalCoverUrl) missing.push("portada");
  return missing;
}

function parseShots(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

const BET_STATUS: Record<string, string> = {
  pending_deposits: "Esperando depósitos",
  ready: "En juego",
  settling: "Liquidando",
  settled: "Resuelta",
  refunding: "Reembolsando",
  cancelled_incomplete: "Cancelada (incompleta)",
  cancelled_admin: "Cancelada (admin)",
  refunded_timeout: "Reembolsada (timeout)",
};

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

function storeFeeFromRevenueShare(revenueShare: number): number {
  return 100 - revenueShare;
}

function RevenueShareControl({
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

// Override por juego del corte de Luna Negra en APUESTAS. `value` null = el juego
// hereda el global (`fallback`). Guardar vacío vuelve a heredar.
function BetFeeControl({
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

function IsBetaControl({
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

function ReviewDetail({
  g,
  betFeeFallback,
  onSaved,
}: {
  g: ReviewGame;
  betFeeFallback: number;
  onSaved: () => void | Promise<void>;
}) {
  const shots = parseShots(g.screenshots);
  return (
    <div className="mt-3 space-y-4 border-t border-line pt-3 text-xs">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-faint">Precio</dt>
          <dd className="text-ink">
            {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Revenue share</dt>
          <dd className="text-ink">
            <RevenueShareControl
              gameId={g.id}
              revenueShare={g.revenueShare}
              onSaved={onSaved}
            />
          </dd>
        </div>
        <div>
          <dt className="text-faint">Comisión apuestas</dt>
          <dd className="text-ink">
            <BetFeeControl
              gameId={g.id}
              value={g.betFeePct}
              fallback={betFeeFallback}
              onSaved={onSaved}
            />
          </dd>
        </div>
        <div>
          <dt className="text-faint">Slug</dt>
          <dd className="font-mono text-ink">{g.slug}</dd>
        </div>
        <div>
          <dt className="text-faint">Categorías</dt>
          <dd className="text-ink">
            {g.categories.length
              ? g.categories.map(categoryLabel).join(", ")
              : "Sin categoría"}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Creado</dt>
          <dd className="text-ink">
            {new Date(g.createdAt).toLocaleString("es-AR")}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Estado Beta</dt>
          <dd className="text-ink">
            <IsBetaControl gameId={g.id} isBeta={g.isBeta} onSaved={onSaved} />
          </dd>
        </div>
        <div>
          <dt className="text-faint">URL del juego</dt>
          <dd className="truncate text-ink">
            {g.gameUrl ? (
              <a
                href={g.gameUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue underline"
              >
                {g.gameUrl}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      <div>
        <p className="text-faint">Descripción</p>
        <p className="mt-1 whitespace-pre-wrap text-ink">
          {g.description?.trim() ? g.description : "—"}
        </p>
      </div>

      {(g.coverUrl || g.horizontalCoverUrl || shots.length > 0) && (
        <div className="space-y-2">
          <p className="text-faint">Imágenes</p>
          <div className="flex flex-wrap gap-2">
            {g.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={g.coverUrl}
                alt="Portada vertical"
                referrerPolicy="no-referrer"
                className="h-32 w-auto rounded border border-line object-cover"
              />
            ) : null}
            {g.horizontalCoverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={g.horizontalCoverUrl}
                alt="Portada horizontal"
                referrerPolicy="no-referrer"
                className="h-32 w-auto rounded border border-line object-cover"
              />
            ) : null}
            {shots.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt={`Captura ${i + 1}`}
                referrerPolicy="no-referrer"
                className="h-32 w-auto rounded border border-line object-cover"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { user, login, loading } = useSession();
  const [games, setGames] = useState<ReviewGame[] | null>(null);
  const [drafts, setDrafts] = useState<DraftGame[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [unannounced, setUnannounced] = useState<Row[]>([]);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [bets, setBets] = useState<BetRow[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationView[]>([]);
  const [economy, setEconomy] = useState<EconomySettings | null>(null);
  const [economyDraft, setEconomyDraft] = useState({
    storeFeePct: "",
    betFeePct: "",
    betDevFeeMaxPct: "",
  });
  const [economyMsg, setEconomyMsg] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<TreasuryInfo | null>(null);
  const [treasuryDraft, setTreasuryDraft] = useState({ minSats: "", maxSats: "" });
  const [treasuryMsg, setTreasuryMsg] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startLoadTransition] = useTransition();

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/games");
    if (r.status === 403) {
      setForbidden(true);
      setGames([]);
      setDrafts([]);
      return;
    }
    const d = await r.json();
    setForbidden(false);
    setGames(d.games ?? []);
    setDrafts(d.drafts ?? []);
    setUnannounced(d.unannounced ?? []);
    setCatalog(d.catalog ?? []);
    const p = await fetch("/api/admin/payouts")
      .then((res) => res.json())
      .catch(() => ({ payouts: [] }));
    setPayouts(p.payouts ?? []);
    const b = await fetch("/api/admin/bets")
      .then((res) => res.json())
      .catch(() => ({ bets: [] }));
    setBets(b.bets ?? []);
    const i = await fetch("/api/admin/integracion")
      .then((res) => res.json())
      .catch(() => ({ views: [] }));
    setIntegrations(i.views ?? []);
    const e = await fetch("/api/admin/economy")
      .then((res) => res.json())
      .catch(() => ({ settings: null }));
    if (e.settings) {
      setEconomy(e.settings);
      setEconomyDraft({
        storeFeePct: String(e.settings.storeFeePct),
        betFeePct: String(e.settings.betFeePct),
        betDevFeeMaxPct: String(e.settings.betDevFeeMaxPct),
      });
    }
    const t = await fetch("/api/admin/treasury")
      .then((res) => res.json())
      .catch(() => null);
    if (t?.settings) {
      setTreasury(t);
      setTreasuryDraft({
        minSats: String(t.settings.minSats),
        maxSats: String(t.settings.maxSats),
      });
    }
  }, []);

  const probeProvider = useCallback(
    async (providerId: string): Promise<ProbeResponse> => {
      const d = await fetch(
        `/api/admin/integracion/probe?providerId=${encodeURIComponent(providerId)}`,
        { method: "POST" },
      )
        .then((res) => res.json())
        .catch(() => ({ results: [], nostr: {} }));
      return { results: d?.results ?? [], nostr: d?.nostr ?? {} };
    },
    [],
  );

  useEffect(() => {
    if (!user) return;
    startLoadTransition(() => {
      void load();
    });
  }, [user, load, startLoadTransition]);

  async function approve(id: string) {
    await fetch(`/api/admin/games/${id}/approve`, { method: "POST" });
    load();
  }

  async function saveEconomy(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("economy");
    setEconomyMsg(null);
    try {
      const r = await fetch("/api/admin/economy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeFeePct: economyDraft.storeFeePct,
          betFeePct: economyDraft.betFeePct,
          betDevFeeMaxPct: economyDraft.betDevFeeMaxPct,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setEconomyMsg(d.error ?? "No se pudieron guardar los porcentajes");
        return;
      }
      setEconomy(d.settings);
      setEconomyDraft({
        storeFeePct: String(d.settings.storeFeePct),
        betFeePct: String(d.settings.betFeePct),
        betDevFeeMaxPct: String(d.settings.betDevFeeMaxPct),
      });
      setEconomyMsg("Porcentajes guardados.");
    } finally {
      setBusy(null);
    }
  }

  async function saveTreasury(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("treasury");
    setTreasuryMsg(null);
    try {
      const r = await fetch("/api/admin/treasury", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minSats: treasuryDraft.minSats,
          maxSats: treasuryDraft.maxSats,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTreasuryMsg(d.error ?? "No se pudieron guardar los límites");
        return;
      }
      setTreasury((prev) => (prev ? { ...prev, settings: d.settings } : prev));
      setTreasuryDraft({
        minSats: String(d.settings.minSats),
        maxSats: String(d.settings.maxSats),
      });
      setTreasuryMsg("Límites guardados.");
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: string) {
    await fetch(`/api/admin/games/${id}/reject`, { method: "POST" });
    load();
  }

  async function removeGame(g: CatalogRow) {
    const warn =
      g.owners > 0
        ? `\n\n${g.owners} usuario(s) lo tienen en su biblioteca y lo perderán.`
        : "";
    if (
      !confirm(
        `¿Borrar "${g.title}" del catálogo? Esta acción es permanente.${warn}`,
      )
    )
      return;
    setBusy(g.id);
    try {
      const r = await fetch(`/api/admin/games/${g.id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error ?? "No se pudo borrar el juego");
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function announce(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/games/${id}/announce`, {
        method: "POST",
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error ?? "No se pudo anunciar el juego");
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function retry(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/admin/payouts/${id}/retry`, { method: "POST" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function cancelBet(id: string, version: 1 | 2) {
    if (!confirm("¿Cancelar esta apuesta incompleta y reembolsar?")) return;
    const base = version === 2 ? "/api/v2/bets" : "/api/escrow/bets";
    await fetch(`${base}/${id}/cancel`, { method: "POST" });
    load();
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Admin</h1>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>
            Conectar con Nostr
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

  const pendingPayoutSats = payouts.reduce((n, p) => n + p.share, 0);
  const activeBets = bets.filter((b) =>
    ["pending_deposits", "ready", "settling", "refunding"].includes(b.status),
  );
  const escrowSats = activeBets.reduce((n, b) => n + b.stakeSats, 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">Admin</h1>
        <div className="flex shrink-0 gap-2">
          <Link href="/admin/visitors" className="btn btn-ghost">
            Quiénes entran
          </Link>
          <Link href="/admin/stats" className="btn btn-ghost">
            Estadísticas
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="En revisión" value={String(games?.length ?? 0)} sub="juegos" accent="var(--blue)" />
        <Kpi label="Sin enviar" value={String(drafts?.length ?? 0)} sub="borradores" accent="var(--ln-corona)" />
        <Kpi label="Payouts a resolver" value={String(payouts.length)} sub={`${pendingPayoutSats.toLocaleString("es-AR")} sats`} accent="var(--btc)" />
        <Kpi label="Escrow retenido" value={escrowSats.toLocaleString("es-AR")} sub={`${activeBets.length} apuestas activas`} accent="var(--btc)" />
        <Kpi label="Apuestas" value={String(bets.length)} sub="en total" accent="var(--win)" />
      </div>

      <section className="mt-8 rounded-lg border border-line bg-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-ink">Porcentajes de Luna Negra</h2>
            <p className="mt-1 text-xs text-faint">
              La tienda usa el reparto por juego; las apuestas nuevas copian la
              comision actual al contrato firmado.
            </p>
          </div>
          {economy?.updatedAt ? (
            <p className="text-[11px] text-faint">
              Actualizado {new Date(economy.updatedAt).toLocaleString("es-AR")}
            </p>
          ) : null}
        </div>

        {economy ? (
          <form onSubmit={saveEconomy} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-muted">
                Comision tienda
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  required
                  className="w-24 rounded border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue/30"
                  value={economyDraft.storeFeePct}
                  onChange={(ev) =>
                    setEconomyDraft((prev) => ({
                      ...prev,
                      storeFeePct: ev.target.value,
                    }))
                  }
                />
                <span className="text-sm text-muted">% Luna Negra</span>
              </div>
              <span className="mt-1 block text-[11px] text-faint">
                Proveedor {100 - (Number(economyDraft.storeFeePct) || 0)}% en juegos nuevos.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted">
                Comision apuestas
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  required
                  className="w-24 rounded border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue/30"
                  value={economyDraft.betFeePct}
                  onChange={(ev) =>
                    setEconomyDraft((prev) => ({
                      ...prev,
                      betFeePct: ev.target.value,
                    }))
                  }
                />
                <span className="text-sm text-muted">% del pozo</span>
              </div>
              <span className="mt-1 block text-[11px] text-faint">
                Se aplica a apuestas creadas desde ahora.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted">
                Tope corte dev
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  required
                  className="w-24 rounded border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue/30"
                  value={economyDraft.betDevFeeMaxPct}
                  onChange={(ev) =>
                    setEconomyDraft((prev) => ({
                      ...prev,
                      betDevFeeMaxPct: ev.target.value,
                    }))
                  }
                />
                <span className="text-sm text-muted">% máx. del pozo</span>
              </div>
              <span className="mt-1 block text-[11px] text-faint">
                Máximo que el dev puede llevarse de una apuesta (se suma al de la casa).
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy === "economy"}>
                {busy === "economy" ? "Guardando..." : "Guardar porcentajes"}
              </Button>
              {economyMsg ? (
                <span className="text-xs text-btc">{economyMsg}</span>
              ) : null}
            </div>
          </form>
        ) : (
          <p className="mt-4 text-sm text-faint">Cargando porcentajes...</p>
        )}
      </section>

      <section className="mt-8 rounded-lg border border-line bg-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-ink">Tesorería (depósito libre)</h2>
            <p className="mt-1 text-xs text-faint">
              Límites del LNURL-pay que acepta cualquier monto y cae al NWC
              {treasury?.address ? (
                <>
                  {" "}(<span className="font-mono text-muted">{treasury.address}</span>)
                </>
              ) : null}
              .
            </p>
          </div>
          {treasury?.settings.updatedAt ? (
            <p className="text-[11px] text-faint">
              Actualizado {new Date(treasury.settings.updatedAt).toLocaleString("es-AR")}
            </p>
          ) : null}
        </div>

        {treasury ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Kpi
                label="Saldo del NWC"
                value={
                  treasury.balanceSats == null
                    ? "—"
                    : `${treasury.balanceSats.toLocaleString("es-AR")} sats`
                }
                sub={
                  !treasury.lightningConfigured
                    ? "NWC no configurado"
                    : treasury.balanceSats == null
                      ? "no respondió"
                      : "en la tesorería"
                }
                accent="var(--btc)"
              />
              <Kpi
                label="Límites actuales"
                value={`${treasury.settings.minSats.toLocaleString("es-AR")}–${treasury.settings.maxSats.toLocaleString("es-AR")}`}
                sub={treasury.settings.configured ? "sats (guardado)" : "sats (default)"}
                accent="var(--blue)"
              />
            </div>

            <form onSubmit={saveTreasury} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-muted">Mínimo</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    required
                    className="w-32 rounded border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue/30"
                    value={treasuryDraft.minSats}
                    onChange={(ev) =>
                      setTreasuryDraft((prev) => ({ ...prev, minSats: ev.target.value }))
                    }
                  />
                  <span className="text-sm text-muted">sats</span>
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">Máximo</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    required
                    className="w-32 rounded border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue/30"
                    value={treasuryDraft.maxSats}
                    onChange={(ev) =>
                      setTreasuryDraft((prev) => ({ ...prev, maxSats: ev.target.value }))
                    }
                  />
                  <span className="text-sm text-muted">sats</span>
                </div>
              </label>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <Button type="submit" disabled={busy === "treasury"}>
                  {busy === "treasury" ? "Guardando..." : "Guardar límites"}
                </Button>
                {treasuryMsg ? (
                  <span className="text-xs text-btc">{treasuryMsg}</span>
                ) : null}
              </div>
            </form>

            <div className="mt-4 rounded border border-line bg-bg/40 p-4 text-xs leading-relaxed text-muted">
              <p className="font-medium text-ink">¿Necesitás un saldo base para que funcione?</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>
                  <span className="text-ink">Recibir no requiere saldo.</span> Los depósitos
                  de apuestas y las recargas a la tesorería solo emiten invoices: no gastan
                  nada del NWC.
                </li>
                <li>
                  <span className="text-ink">Los premios se auto-financian.</span> Lo que
                  cobra el ganador sale del propio pozo (los depósitos ya están en el NWC),
                  así que no ponés plata de tu bolsillo por el premio.
                </li>
                <li>
                  <span className="text-ink">Sí conviene una reserva chica para el ruteo.</span>{" "}
                  Pagar por Lightning cuesta un fee de ruteo (unos pocos sats) que sale de tu
                  liquidez. Sin liquidez de salida suficiente, los payouts fallan y quedan
                  para reintentar en “Payouts a resolver”.
                </li>
              </ul>
              {treasury.lightningConfigured && treasury.balanceSats === 0 ? (
                <p className="mt-2 text-[var(--ln-corona)]">
                  ⚠ El NWC está en 0 sats: vas a poder cobrar depósitos, pero los payouts
                  fallarán hasta que haya liquidez de salida (mandá una recarga a la tesorería).
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-faint">Cargando tesorería...</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-1 font-semibold text-ink">Borradores sin enviar</h2>
        <p className="mb-3 text-xs text-faint">
          Juegos que ahora están fuera de revisión; incluye fichas nuevas o
          devueltas a borrador. Los más antiguos aparecen primero.
        </p>
        {drafts === null ? (
          <p className="text-sm text-faint">Cargando…</p>
        ) : drafts.length === 0 ? (
          <p className="text-muted">No hay borradores pendientes.</p>
        ) : (
          <ul className="space-y-2">
            {drafts.map((g) => {
              const missing = missingDraftFields(g);
              const ownerLabel =
                g.provider.owner.displayName?.trim() ||
                shortNpub(g.provider.owner.npub);
              return (
                <li
                  key={g.id}
                  className="rounded-lg border border-line bg-panel px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {g.title}
                      </p>
                      <p className="mt-0.5 text-xs text-faint">
                        {g.provider.name} · Dueño: {" "}
                        <a
                          href={`https://njump.me/${g.provider.owner.npub}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue hover:underline"
                        >
                          {ownerLabel}
                        </a>
                      </p>
                      <p className="mt-1 text-[11px] text-faint">
                        Creado {draftAge(g.createdAt)} · {" "}
                        <time dateTime={g.createdAt}>
                          {ADMIN_DATE.format(new Date(g.createdAt))}
                        </time>
                      </p>
                    </div>
                    <span
                      className={
                        missing.length === 0
                          ? "shrink-0 rounded border border-ln-corona/35 bg-ln-corona/10 px-2 py-1 text-[11px] font-medium text-ln-corona"
                          : "shrink-0 rounded border border-line px-2 py-1 text-[11px] text-muted"
                      }
                    >
                      {missing.length === 0
                        ? "Parece listo para enviar"
                        : `${4 - missing.length}/4 datos de ficha`}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {missing.length === 0
                      ? "Tiene URL, descripción, categoría y portada."
                      : `Pendiente: ${missing.join(", ")}.`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-semibold text-ink">Juegos en revisión</h2>
        {games === null ? (
          <p className="text-sm text-faint">Cargando…</p>
        ) : games.length === 0 ? (
          <p className="text-muted">No hay juegos en revisión.</p>
        ) : (
          <ul className="space-y-2">
            {games.map((g) => {
              const open = expanded === g.id;
              return (
                <li
                  key={g.id}
                  className="rounded-lg border border-line bg-panel px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : g.id)}
                      className="min-w-0 flex-1 text-left"
                      aria-expanded={open}
                    >
                      <p className="text-sm font-medium">
                        <span className="mr-1.5 inline-block text-faint">
                          {open ? "▾" : "▸"}
                        </span>
                        {g.title}
                      </p>
                      <p className="text-xs text-faint">
                        {g.provider.name} ·{" "}
                        {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`}
                      </p>
                    </button>
                    <div className="flex shrink-0 gap-2">
                      <Button onClick={() => approve(g.id)}>Aprobar</Button>
                      <Button variant="ghost" onClick={() => reject(g.id)}>
                        Rechazar
                      </Button>
                    </div>
                  </div>
                  {open ? (
                    <ReviewDetail
                      g={g}
                      betFeeFallback={economy?.betFeePct ?? 5}
                      onSaved={load}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {unannounced.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-1 font-semibold text-ink">Sin anuncio en Nostr</h2>
          <p className="mb-3 text-xs text-faint">
            Juegos publicados sin posteo raíz. Anunciá para que comentarios y
            reseñas se cuelguen de un hilo en Nostr.
          </p>
          <ul className="space-y-2">
            {unannounced.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-faint">{g.provider.name}</p>
                </div>
                <Button onClick={() => announce(g.id)} disabled={busy === g.id}>
                  {busy === g.id ? "Anunciando…" : "Anunciar en Nostr"}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10">
        <h2 className="mb-1 font-semibold text-ink">Catálogo publicado</h2>
        <p className="mb-3 text-xs text-faint">
          Borrar un juego es permanente: se quita del catálogo y de la
          biblioteca de quienes lo poseen. Bloqueado si tiene apuestas activas.
        </p>
        {catalog.length === 0 ? (
          <p className="text-muted">No hay juegos publicados.</p>
        ) : (
          <ul className="space-y-2">
            {catalog.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-faint">
                    {g.provider.name} ·{" "}
                    {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`} ·{" "}
                    {g.owners} en biblioteca
                  </p>
                  <div className="mt-1 text-xs text-faint flex gap-3 items-center">
                    <RevenueShareControl
                      gameId={g.id}
                      revenueShare={g.revenueShare}
                      onSaved={load}
                      compact
                    />
                    <div className="w-[1px] h-3 bg-line"></div>
                    <IsBetaControl gameId={g.id} isBeta={g.isBeta} onSaved={load} />
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => removeGame(g)}
                  disabled={busy === g.id}
                >
                  {busy === g.id ? "Borrando…" : "Borrar"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-semibold text-ink">Payouts a resolver</h2>
        {payouts.length === 0 ? (
          <p className="text-muted">Todos los payouts están al día. 🎉</p>
        ) : (
          <ul className="space-y-2">
            {payouts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {p.gameTitle}{" "}
                    <span className="text-xs text-btc">
                      ({PAYOUT_LABEL[p.payoutStatus] ?? p.payoutStatus})
                    </span>
                  </p>
                  <p className="text-xs text-faint">
                    {p.providerName} · {p.share} sats →{" "}
                    {p.lightningAddress ?? "sin Lightning Address"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => retry(p.id)}
                  disabled={busy === p.id}
                >
                  {busy === p.id ? "Reintentando…" : "Reintentar"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-semibold text-ink">Apuestas</h2>
        {bets.length === 0 ? (
          <p className="text-muted">No hay apuestas.</p>
        ) : (
          <ul className="space-y-2">
            {bets.map((b) => (
              <li
                key={`${b.version}:${b.id}`}
                className="rounded-lg border border-line bg-panel px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {b.gameTitle}
                      {b.version === 2 ? (
                        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                          ⚡ v2
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-faint">
                      {BET_STATUS[b.status] ?? b.status} · {b.stakeSats} sats ·{" "}
                      {b.paid}/{b.total} pagaron
                    </p>
                  </div>
                  {b.status === "pending_deposits" ? (
                    <Button variant="ghost" onClick={() => cancelBet(b.id, b.version)}>
                      Cancelar
                    </Button>
                  ) : null}
                </div>
                {b.payouts.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-t border-line pt-2">
                    {b.payouts.map((p) => (
                      <li key={p.npub} className="text-[11px] text-faint">
                        <span className="font-mono">{p.npub.slice(0, 12)}…</span> ·{" "}
                        {p.payoutSats} sats ·{" "}
                        {p.payoutStatus === "paid" &&
                        p.payoutDestination &&
                        p.payoutDestination !== "lnurl-withdraw" ? (
                          <>
                            💸 <span className="font-mono text-muted">{p.payoutDestination}</span>
                            {p.payoutKind ? ` (${p.payoutKind})` : ""}
                          </>
                        ) : p.payoutStatus === "claimed" ? (
                          "🎟️ cobrado por QR"
                        ) : p.payoutStatus === "withdraw_pending" ? (
                          "🎟️ retiro por QR"
                        ) : (
                          p.payoutStatus
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-1 font-semibold text-ink">Integración de juegos</h2>
        <p className="mb-4 text-xs text-faint">
          Qué tiene cableada cada juego en tres columnas: solo 1.0 (REST), intermedio
          (REST 1.0 ⇆ eventos Nostr 2.0) y solo 2.0 (Nostr). Verde = en uso reciente;
          naranja = visto hace tiempo o configurado; azul = declarado/disponible (2.0);
          gris = diseño o no integrado.
        </p>
        {integrations.length === 0 ? (
          <p className="text-muted">No hay proveedores.</p>
        ) : (
          <div className="space-y-6">
            {integrations.map((view) => (
              <div key={view.provider.id}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {view.provider.name}
                    <span className="ml-2 text-xs font-normal text-faint">
                      {view.games.length} juego(s) · {view.provider.apiKeys} API key(s)
                      {view.provider.webhookConfigured ? " · webhook ✓" : ""}
                    </span>
                  </p>
                </div>
                <IntegrationMatrix
                  view={view}
                  compact
                  onProbe={() => probeProvider(view.provider.id)}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
