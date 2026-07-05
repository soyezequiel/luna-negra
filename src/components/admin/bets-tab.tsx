"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BetDetail } from "@/components/admin/bet-detail";
import {
  type BetRow,
  type Payout,
  BET_STATUS,
  PAYOUT_LABEL,
} from "./admin-types";

export function BetsTab({
  bets,
  payouts,
  busy,
  onRetry,
  onCancelBet,
}: {
  bets: BetRow[];
  payouts: Payout[];
  busy: string | null;
  onRetry: (id: string) => void;
  onCancelBet: (id: string, version: 1 | 2) => void;
}) {
  const [expandedBet, setExpandedBet] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      {/* Payouts a resolver */}
      <section>
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
                  onClick={() => onRetry(p.id)}
                  disabled={busy === p.id}
                >
                  {busy === p.id ? "Reintentando…" : "Reintentar"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Apuestas */}
      <section>
        <h2 className="mb-3 font-semibold text-ink">Apuestas</h2>
        {bets.length === 0 ? (
          <p className="text-muted">No hay apuestas.</p>
        ) : (
          <ul className="space-y-2">
            {bets.map((b) => {
              const key = `${b.version}:${b.id}`;
              const open = expandedBet === key;
              return (
                <li
                  key={key}
                  className="rounded-lg border border-line bg-panel px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpandedBet(open ? null : key)}
                      aria-expanded={open}
                    >
                      <p className="text-sm font-medium">
                        <span className="mr-1 inline-block text-faint">{open ? "▾" : "▸"}</span>
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
                    </button>
                    {b.status === "pending_deposits" ? (
                      <Button variant="ghost" onClick={() => onCancelBet(b.id, b.version)}>
                        Cancelar
                      </Button>
                    ) : null}
                  </div>
                  {open ? <BetDetail betId={b.id} version={b.version} /> : null}
                  {!open && b.payouts.length > 0 ? (
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
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
