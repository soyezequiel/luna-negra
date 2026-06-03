"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";

type Row = {
  id: string;
  title: string;
  slug: string;
  priceSats: number;
  provider: { name: string };
};
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

export default function AdminPage() {
  const { user, login, loading } = useSession();
  const [games, setGames] = useState<Row[] | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [bets, setBets] = useState<BetRow[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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
    if (user) load();
  }, [user, load]);

  async function approve(id: string) {
    await fetch(`/api/admin/games/${id}/approve`, { method: "POST" });
    load();
  }

  async function reject(id: string) {
    await fetch(`/api/admin/games/${id}/reject`, { method: "POST" });
    load();
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
        <h1 className="text-2xl font-bold">Admin</h1>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-zinc-400">
        No estás autorizado para ver esta página.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Admin</h1>

      <section className="mt-6">
        <h2 className="mb-3 font-semibold">Juegos en revisión</h2>
        {games === null ? (
          <p className="text-sm text-zinc-500">Cargando…</p>
        ) : games.length === 0 ? (
          <p className="text-zinc-400">No hay juegos en revisión.</p>
        ) : (
          <ul className="space-y-2">
            {games.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-zinc-500">
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

      <section className="mt-10">
        <h2 className="mb-3 font-semibold">Payouts a resolver</h2>
        {payouts.length === 0 ? (
          <p className="text-zinc-400">Todos los payouts están al día. 🎉</p>
        ) : (
          <ul className="space-y-2">
            {payouts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {p.gameTitle}{" "}
                    <span className="text-xs text-amber-400">
                      ({PAYOUT_LABEL[p.payoutStatus] ?? p.payoutStatus})
                    </span>
                  </p>
                  <p className="text-xs text-zinc-500">
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
        <h2 className="mb-3 font-semibold">Apuestas</h2>
        {bets.length === 0 ? (
          <p className="text-zinc-400">No hay apuestas.</p>
        ) : (
          <ul className="space-y-2">
            {bets.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{b.gameTitle}</p>
                  <p className="text-xs text-zinc-500">
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
