"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import type { IntegrationView, ProbeResponse } from "@/components/provider/integration-matrix";
import { Kpi } from "@/components/admin/admin-controls";
import { AdminTabBar, type AdminTab, ADMIN_TABS } from "@/components/admin/admin-tabs";
import { GamesTab } from "@/components/admin/games-tab";
import { EconomyTab } from "@/components/admin/economy-tab";
import { BetsTab } from "@/components/admin/bets-tab";
import { IntegrationTab } from "@/components/admin/integration-tab";
import type {
  ReviewGame,
  DraftGame,
  CatalogRow,
  Row,
  Payout,
  BetRow,
  EconomySettings,
  TreasuryInfo,
  PresenceSettings,
} from "@/components/admin/admin-types";

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageInner />
    </Suspense>
  );
}

function AdminPageInner() {
  const { user, login, loading } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();

  // ── Tab state (synced with URL) ──
  const rawTab = searchParams.get("tab") ?? "juegos";
  const activeTab: AdminTab = ADMIN_TABS.some((t) => t.id === rawTab)
    ? (rawTab as AdminTab)
    : "juegos";

  function setTab(tab: AdminTab) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    router.replace(url.pathname + url.search, { scroll: false });
  }

  // ── Data state ──
  const [games, setGames] = useState<ReviewGame[] | null>(null);
  const [drafts, setDrafts] = useState<DraftGame[] | null>(null);
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
  const [houseEarnings, setHouseEarnings] = useState<{
    totalSats: number;
    betFeeSats: number;
    storeCommissionSats: number;
  } | null>(null);
  const [treasury, setTreasury] = useState<TreasuryInfo | null>(null);
  const [treasuryDraft, setTreasuryDraft] = useState({ minSats: "", maxSats: "" });
  const [treasuryMsg, setTreasuryMsg] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceSettings | null>(null);
  const [presenceMsg, setPresenceMsg] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startLoadTransition] = useTransition();

  // ── Data loading ──
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
    const earn = await fetch("/api/admin/earnings")
      .then((res) => res.json())
      .catch(() => ({ earnings: null }));
    setHouseEarnings(earn?.earnings ?? null);
    const pres = await fetch("/api/admin/presence")
      .then((res) => res.json())
      .catch(() => ({ settings: null }));
    setPresence(pres?.settings ?? null);
  }, []);

  const probeProvider = useCallback(
    async (providerId: string): Promise<ProbeResponse> => {
      const d = await fetch(
        `/api/admin/integracion/probe?providerId=${encodeURIComponent(providerId)}`,
        { method: "POST" },
      )
        .then((res) => res.json())
        .catch(() => ({ nostr: {} }));
      return { nostr: d?.nostr ?? {} };
    },
    [],
  );

  useEffect(() => {
    if (!user) return;
    startLoadTransition(() => {
      void load();
    });
  }, [user, load, startLoadTransition]);

  // ── Actions ──
  async function approve(id: string) {
    await fetch(`/api/admin/games/${id}/approve`, { method: "POST" });
    load();
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
    // Las apuestas v2 (por zaps) se resuelven/expiran por el motor de escrow v2 y
    // el oráculo NGE; ya no hay cancelación REST manual (la superficie externa por
    // API key fue retirada). Solo se cancela manualmente el motor v1.
    if (version === 2) {
      alert(
        "Las apuestas v2 (por zaps) expiran/se resuelven solas por el escrow v2; no se cancelan manualmente desde acá.",
      );
      return;
    }
    if (!confirm("¿Cancelar esta apuesta incompleta y reembolsar?")) return;
    await fetch(`/api/escrow/bets/${id}/cancel`, { method: "POST" });
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

  async function togglePresence(enabled: boolean) {
    setBusy("presence");
    setPresenceMsg(null);
    try {
      const r = await fetch("/api/admin/presence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clickPresenceEnabled: enabled }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPresenceMsg(d.error ?? "No se pudo guardar el ajuste");
        return;
      }
      setPresence(d.settings);
      setPresenceMsg(
        enabled
          ? "Presencia optimista activada."
          : "Presencia optimista desactivada: solo queda la NIP-38 del juego.",
      );
    } finally {
      setBusy(null);
    }
  }

  // ── Auth guards ──
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

  // ── Computed values for KPIs ──
  const pendingPayoutSats = payouts.reduce((n, p) => n + p.share, 0);
  const activeBets = bets.filter((b) =>
    ["pending_deposits", "ready", "settling", "refunding"].includes(b.status),
  );
  const escrowSats = activeBets.reduce((n, b) => n + b.stakeSats, 0);

  // ── Tab badges ──
  const badges: Partial<Record<AdminTab, number>> = {};
  const gamesCount = (games?.length ?? 0) + (drafts?.length ?? 0) + unannounced.length;
  if (gamesCount > 0) badges.juegos = gamesCount;
  if (payouts.length > 0) badges.apuestas = payouts.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">Admin</h1>
        <div className="flex shrink-0 gap-2">
          <Link href="/admin/visitors" className="btn btn-ghost">
            Quiénes entran
          </Link>
          <Link href="/admin/stats" className="btn btn-ghost">
            Estadísticas
          </Link>
          <Link href="/admin/diagnostico-presencia" className="btn btn-ghost">
            Diagnóstico presencia
          </Link>
        </div>
      </div>

      {/* Hero KPI: Ganancias */}
      <div
        className="mt-6 rounded-lg border border-line bg-panel p-5"
        style={{ borderLeft: "3px solid var(--win)" }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
          Ganancias Luna Negra
        </p>
        <p className="mt-1 text-[34px] font-bold leading-none text-ink">
          {houseEarnings
            ? `${houseEarnings.totalSats.toLocaleString("es-AR")} sats`
            : "—"}
        </p>
        <p className="mt-1.5 text-[11.5px] text-muted">
          {houseEarnings
            ? `${houseEarnings.betFeeSats.toLocaleString("es-AR")} sats de apuestas · ${houseEarnings.storeCommissionSats.toLocaleString("es-AR")} sats de comisión de ventas`
            : "Cargando…"}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="En revisión" value={String(games?.length ?? 0)} sub="juegos" accent="var(--blue)" />
        <Kpi label="Sin enviar" value={String(drafts?.length ?? 0)} sub="borradores" accent="var(--ln-corona)" />
        <Kpi label="Payouts a resolver" value={String(payouts.length)} sub={`${pendingPayoutSats.toLocaleString("es-AR")} sats`} accent="var(--btc)" />
        <Kpi label="Escrow retenido" value={escrowSats.toLocaleString("es-AR")} sub={`${activeBets.length} apuestas activas`} accent="var(--btc)" />
        <Kpi label="Apuestas" value={String(bets.length)} sub="en total" accent="var(--win)" />
      </div>

      {/* Tab Bar */}
      <div className="mt-6">
        <AdminTabBar active={activeTab} onChange={setTab} badges={badges} />
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === "juegos" && (
          <GamesTab
            drafts={drafts}
            games={games}
            unannounced={unannounced}
            catalog={catalog}
            betFeeFallback={economy?.betFeePct ?? 5}
            busy={busy}
            onApprove={approve}
            onReject={reject}
            onAnnounce={announce}
            onRemoveGame={removeGame}
            onLoad={load}
          />
        )}
        {activeTab === "economia" && (
          <EconomyTab
            economy={economy}
            economyDraft={economyDraft}
            setEconomyDraft={setEconomyDraft}
            economyMsg={economyMsg}
            onSaveEconomy={saveEconomy}
            treasury={treasury}
            treasuryDraft={treasuryDraft}
            setTreasuryDraft={setTreasuryDraft}
            treasuryMsg={treasuryMsg}
            onSaveTreasury={saveTreasury}
            busy={busy}
          />
        )}
        {activeTab === "apuestas" && (
          <BetsTab
            bets={bets}
            payouts={payouts}
            busy={busy}
            onRetry={retry}
            onCancelBet={cancelBet}
          />
        )}
        {activeTab === "integracion" && (
          <IntegrationTab
            integrations={integrations}
            probeProvider={probeProvider}
            presence={presence}
            presenceMsg={presenceMsg}
            onTogglePresence={togglePresence}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
