"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Kpi } from "./admin-controls";
import type { EconomySettings, TreasuryInfo } from "./admin-types";

export function EconomyTab({
  economy,
  economyDraft,
  setEconomyDraft,
  economyMsg,
  onSaveEconomy,
  treasury,
  treasuryDraft,
  setTreasuryDraft,
  treasuryMsg,
  onSaveTreasury,
  busy,
}: {
  economy: EconomySettings | null;
  economyDraft: { storeFeePct: string; betFeePct: string; betDevFeeMaxPct: string };
  setEconomyDraft: (fn: (prev: { storeFeePct: string; betFeePct: string; betDevFeeMaxPct: string }) => { storeFeePct: string; betFeePct: string; betDevFeeMaxPct: string }) => void;
  economyMsg: string | null;
  onSaveEconomy: (e: FormEvent<HTMLFormElement>) => void;
  treasury: TreasuryInfo | null;
  treasuryDraft: { minSats: string; maxSats: string };
  setTreasuryDraft: (fn: (prev: { minSats: string; maxSats: string }) => { minSats: string; maxSats: string }) => void;
  treasuryMsg: string | null;
  onSaveTreasury: (e: FormEvent<HTMLFormElement>) => void;
  busy: string | null;
}) {
  return (
    <div className="space-y-8">
      {/* Porcentajes de Luna Negra */}
      <section className="rounded-lg border border-line bg-panel p-5">
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
          <form onSubmit={onSaveEconomy} className="mt-4 grid gap-4 sm:grid-cols-2">
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

      {/* Tesorería */}
      <section className="rounded-lg border border-line bg-panel p-5">
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

            <form onSubmit={onSaveTreasury} className="mt-4 grid gap-4 sm:grid-cols-2">
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
                  para reintentar en "Payouts a resolver".
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
    </div>
  );
}
