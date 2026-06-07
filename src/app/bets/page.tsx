"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";

type Row = {
  id: string;
  gameTitle: string;
  status: string;
  stakeSats: number;
  depositStatus: string;
  result: string;
};

const STATUS: Record<string, string> = {
  created: "Creada",
  pending_deposits: "Esperando depósitos",
  ready: "En juego",
  settling: "Liquidando",
  settled: "Resuelta",
  refunding: "Reembolsando",
  cancelled_incomplete: "Cancelada",
  cancelled_admin: "Cancelada",
  refunded_timeout: "Reembolsada",
  voided: "Anulada",
};

export default function BetsHistoryPage() {
  const { user, login, loading } = useSession();
  const [bets, setBets] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch("/api/escrow/bets/mine")
      .then((r) => r.json())
      .then((d) => setBets(d.bets ?? []))
      .catch(() => setBets([]));
  }, [user]);

  if (loading) return null;
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Apuestas</h1>
        <p className="mt-2 text-zinc-400">Conectá tu Nostr para ver tus apuestas.</p>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Tus apuestas</h1>
      {bets === null ? (
        <p className="mt-2 text-sm text-zinc-500">Cargando…</p>
      ) : bets.length === 0 ? (
        <p className="mt-2 text-zinc-400">Todavía no participaste en apuestas.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {bets.map((b) => (
            <li key={b.id}>
              <Link
                href={`/bets/${b.id}`}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 hover:border-sky-500/40"
              >
                <div>
                  <p className="text-sm font-medium">{b.gameTitle}</p>
                  <p className="text-xs text-zinc-500">
                    {STATUS[b.status] ?? b.status} · {b.stakeSats} sats
                    {b.status === "settled" ? ` · ${b.result}` : ""}
                  </p>
                </div>
                <span className="text-xs text-sky-400">Ver →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
