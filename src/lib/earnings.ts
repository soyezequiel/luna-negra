/**
 * Ganancias agregadas (totales, no por-juego) para los paneles: lo que ganó un
 * proveedor y lo que ganó Luna Negra (la casa). Suma AMBOS ledgers: v1 (escrow,
 * `LedgerEntry`) y v2 (zaps, `ZapLedgerEntry`), que conviven. Los cortes por
 * apuesta suelen ser sub-sat, así que se suma en msat y se convierte a sats UNA
 * sola vez al final (convertir por-asiento evaporaría cada fracción <1 sat).
 */

import { prisma } from "@/lib/prisma";
import { msatToSats } from "@/lib/money";

export type ProviderBetEarnings = {
  totalSats: number;
  settledSats: number; // ya cobrado a la Lightning Address del dev
  pendingSats: number; // por cobrar (retenido / sin destino aún)
  failedSats: number; // el pago falló (se reintenta / quedó colgado)
  betCount: number; // cantidad de asientos dev_fee (apuestas que dejaron corte)
};

/**
 * Lo que ganó un proveedor por apuestas = asientos `dev_fee` de SUS apuestas
 * (v1 + v2), desglosado por estado del cobro.
 */
export async function getProviderBetEarnings(
  providerId: string,
): Promise<ProviderBetEarnings> {
  const [v1, v2] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { kind: "dev_fee", bet: { providerId } },
      select: { amountMsat: true, status: true },
    }),
    prisma.zapLedgerEntry.findMany({
      where: { kind: "dev_fee", bet: { providerId } },
      select: { amountMsat: true, status: true },
    }),
  ]);

  let total = 0n;
  let settled = 0n;
  let pending = 0n;
  let failed = 0n;
  let count = 0;
  for (const e of [...v1, ...v2]) {
    total += e.amountMsat;
    if (e.status === "settled") settled += e.amountMsat;
    else if (e.status === "failed") failed += e.amountMsat;
    else pending += e.amountMsat;
    count += 1;
  }

  return {
    totalSats: Number(msatToSats(total)),
    settledSats: Number(msatToSats(settled)),
    pendingSats: Number(msatToSats(pending)),
    failedSats: Number(msatToSats(failed)),
    betCount: count,
  };
}

export type HouseEarnings = {
  totalSats: number;
  betFeeSats: number; // corte de la casa en apuestas (ledger `fee`, v1 + v2)
  storeCommissionSats: number; // comisión de la tienda sobre ventas pagadas
};

/**
 * Lo que ganó Luna Negra (la casa) = corte de la casa en apuestas (asientos `fee`,
 * userId null, v1 + v2) + comisión de la tienda sobre las ventas pagadas (precio −
 * parte del proveedor). No cuenta forfeits (premios no reclamados que quedan en la
 * casa): son esporádicos y sin serie limpia, igual que en game-stats.
 */
export async function getHouseEarnings(): Promise<HouseEarnings> {
  const [v1Fee, v2Fee, purchases] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { kind: "fee" },
      select: { amountMsat: true },
    }),
    prisma.zapLedgerEntry.findMany({
      where: { kind: "fee" },
      select: { amountMsat: true },
    }),
    prisma.purchase.findMany({
      where: { status: "paid" },
      select: { amountSats: true, game: { select: { revenueShare: true } } },
    }),
  ]);

  let feeMsat = 0n;
  for (const e of [...v1Fee, ...v2Fee]) feeMsat += e.amountMsat;

  let commission = 0;
  for (const p of purchases) {
    const share = Math.floor((p.amountSats * p.game.revenueShare) / 100);
    commission += p.amountSats - share;
  }

  const betFeeSats = Number(msatToSats(feeMsat));
  return {
    totalSats: betFeeSats + commission,
    betFeeSats,
    storeCommissionSats: commission,
  };
}
