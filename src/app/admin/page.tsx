"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";

type Row = {
  id: string;
  title: string;
  slug: string;
  priceSats: number;
  provider: { name: string };
};
type CatalogRow = Row & { owners: number };
type Payout = {
  id: string;
  gameTitle: string;
  providerName: string;
  lightningAddress: string | null;
  share: number;
  payoutStatus: string;
};

type BetRow = {
  id: string;
  gameTitle: string;
  status: string;
  stakeSats: number;
  paid: number;
  total: number;
};

const PAYOUT_LABEL: Record<string, string> = {
  pending: "En proceso",
  failed: "Falló",
  skipped: "Sin dirección",
};

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

export default function AdminPage() {
  const { user, login, loading } = useSession();
  const [games, setGames] = useState<Row[] | null>(null);
  const [unannounced, setUnannounced] = useState<Row[]>([]);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [bets, setBets] = useState<BetRow[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startLoadTransition] = useTransition();

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/games");
    if (r.status === 403) {
      setForbidden(true);
      setGames([]);
      return;
    }
    const d = await r.json();
    setForbidden(false);
    setGames(d.games ?? []);
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
  }, []);

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

  async function cancelBet(id: string) {
    if (!confirm("¿Cancelar esta apuesta incompleta y reembolsar?")) return;
    await fetch(`/api/escrow/bets/${id}/cancel`, { method: "POST" });
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
      <h1 className="text-3xl font-bold tracking-tight text-white">Admin</h1>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="En revisión" value={String(games?.length ?? 0)} sub="juegos" accent="var(--blue)" />
        <Kpi label="Payouts a resolver" value={String(payouts.length)} sub={`${pendingPayoutSats.toLocaleString("es-AR")} sats`} accent="var(--btc)" />
        <Kpi label="Escrow retenido" value={escrowSats.toLocaleString("es-AR")} sub={`${activeBets.length} apuestas activas`} accent="var(--btc)" />
        <Kpi label="Apuestas" value={String(bets.length)} sub="en total" accent="var(--win)" />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-semibold text-ink">Juegos en revisión</h2>
        {games === null ? (
          <p className="text-sm text-faint">Cargando…</p>
        ) : games.length === 0 ? (
          <p className="text-muted">No hay juegos en revisión.</p>
        ) : (
          <ul className="space-y-2">
            {games.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-faint">
                    {g.provider.name} ·{" "}
                    {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => approve(g.id)}>Aprobar</Button>
                  <Button variant="ghost" onClick={() => reject(g.id)}>
                    Rechazar
                  </Button>
                </div>
              </li>
            ))}
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
                className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-faint">
                    {g.provider.name} ·{" "}
                    {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`} ·{" "}
                    {g.owners} en biblioteca
                  </p>
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
                key={b.id}
                className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{b.gameTitle}</p>
                  <p className="text-xs text-faint">
                    {BET_STATUS[b.status] ?? b.status} · {b.stakeSats} sats ·{" "}
                    {b.paid}/{b.total} pagaron
                  </p>
                </div>
                {b.status === "pending_deposits" ? (
                  <Button variant="ghost" onClick={() => cancelBet(b.id)}>
                    Cancelar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
