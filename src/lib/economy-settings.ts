import { BET_FEE_PCT } from "@/lib/escrow-config";
import { prisma } from "@/lib/prisma";

const SETTINGS_ID = "global";

function envPercent(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const pct = Math.floor(n);
  return pct >= 0 && pct <= 100 ? pct : fallback;
}

export const DEFAULT_STORE_FEE_PCT = envPercent(process.env.STORE_FEE_PCT, 30);
export const DEFAULT_BET_FEE_PCT = envPercent(String(BET_FEE_PCT), 5);
export const DEFAULT_BET_DEV_FEE_MAX_PCT = envPercent(
  process.env.BET_DEV_FEE_MAX_PCT,
  20,
);

export type EconomySettings = {
  storeFeePct: number;
  providerRevenueShare: number;
  betFeePct: number;
  /** Tope máximo del corte del dev sobre las apuestas (lo fija el admin). */
  betDevFeeMaxPct: number;
  updatedAt: Date | null;
  configured: boolean;
};

export function providerShareFromStoreFee(storeFeePct: number): number {
  return 100 - storeFeePct;
}

export function normalizePercent(value: unknown, label: string): number {
  if (typeof value === "string" && value.trim() === "") {
    throw new Error(`${label} debe ser un porcentaje valido`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label} debe ser un porcentaje valido`);
  }
  const pct = Math.floor(n);
  if (pct < 0 || pct > 100) {
    throw new Error(`${label} debe estar entre 0 y 100`);
  }
  return pct;
}

function toSettings(row: {
  storeFeePct: number;
  betFeePct: number;
  betDevFeeMaxPct: number;
  updatedAt: Date;
} | null): EconomySettings {
  const storeFeePct = row?.storeFeePct ?? DEFAULT_STORE_FEE_PCT;
  return {
    storeFeePct,
    providerRevenueShare: providerShareFromStoreFee(storeFeePct),
    betFeePct: row?.betFeePct ?? DEFAULT_BET_FEE_PCT,
    betDevFeeMaxPct: row?.betDevFeeMaxPct ?? DEFAULT_BET_DEV_FEE_MAX_PCT,
    updatedAt: row?.updatedAt ?? null,
    configured: row !== null,
  };
}

/**
 * Resuelve los DOS cortes (casa + dev) que se congelan en una apuesta al crearla,
 * aplicando los overrides por juego y el tope global del corte del dev:
 *   feePct    = override del juego (admin) ?? global de la casa
 *   devFeePct = min(override del juego (dev) ?? default del proveedor, tope global)
 * El tope es la última palabra: aunque el dev configure más, se acota.
 */
export function resolveBetFees(args: {
  game: { betFeePct: number | null; betDevFeePct: number | null };
  provider: { betDevFeePct: number };
  economy: EconomySettings;
}): { feePct: number; devFeePct: number } {
  const { game, provider, economy } = args;
  const feePct = game.betFeePct ?? economy.betFeePct;
  const devWanted = game.betDevFeePct ?? provider.betDevFeePct;
  const devFeePct = Math.min(devWanted, economy.betDevFeeMaxPct);
  return { feePct, devFeePct };
}

export async function getEconomySettings(): Promise<EconomySettings> {
  const row = await prisma.platformSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  return toSettings(row);
}

export async function updateEconomySettings(input: {
  storeFeePct?: unknown;
  betFeePct?: unknown;
  betDevFeeMaxPct?: unknown;
}): Promise<EconomySettings> {
  const current = await getEconomySettings();
  const storeFeePct =
    input.storeFeePct === undefined
      ? current.storeFeePct
      : normalizePercent(input.storeFeePct, "La comision de tienda");
  const betFeePct =
    input.betFeePct === undefined
      ? current.betFeePct
      : normalizePercent(input.betFeePct, "La comision de apuestas");
  const betDevFeeMaxPct =
    input.betDevFeeMaxPct === undefined
      ? current.betDevFeeMaxPct
      : normalizePercent(input.betDevFeeMaxPct, "El tope del corte del dev");

  const row = await prisma.platformSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, storeFeePct, betFeePct, betDevFeeMaxPct },
    update: { storeFeePct, betFeePct, betDevFeeMaxPct },
  });
  return toSettings(row);
}

export function economySettingsPayload(settings: EconomySettings) {
  return {
    storeFeePct: settings.storeFeePct,
    providerRevenueShare: settings.providerRevenueShare,
    betFeePct: settings.betFeePct,
    betDevFeeMaxPct: settings.betDevFeeMaxPct,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    configured: settings.configured,
  };
}
