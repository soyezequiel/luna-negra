import { prisma } from "@/lib/prisma";

// Límites del depósito LIBRE a la tesorería (ver .well-known/lnurlp/tesoreria).
// Se guardan en la misma fila global de PlatformSettings que la economía, pero son
// un concepto aparte, así que viven en su propio módulo (espejo de economy-settings).
// Si el admin no los tocó, se usan los defaults del entorno.

const SETTINGS_ID = "global";
// Guarda de cordura: 21M BTC en sats (no tiene sentido un límite mayor).
const MAX_SATS_CAP = 2_100_000_000_000_000;

function envSats(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export const DEFAULT_TREASURY_MIN_SATS = envSats(process.env.TREASURY_MIN_SATS, 1);
export const DEFAULT_TREASURY_MAX_SATS = envSats(
  process.env.TREASURY_MAX_SATS,
  10_000_000,
);

export type TreasurySettings = {
  minSats: number;
  maxSats: number;
  updatedAt: Date | null;
  /** ¿El admin ya guardó límites propios (o corre con los del entorno)? */
  configured: boolean;
};

function toSettings(
  row: { treasuryMinSats: number | null; treasuryMaxSats: number | null; updatedAt: Date } | null,
): TreasurySettings {
  return {
    minSats: row?.treasuryMinSats ?? DEFAULT_TREASURY_MIN_SATS,
    maxSats: row?.treasuryMaxSats ?? DEFAULT_TREASURY_MAX_SATS,
    updatedAt: row?.updatedAt ?? null,
    configured: row?.treasuryMinSats != null || row?.treasuryMaxSats != null,
  };
}

export async function getTreasurySettings(): Promise<TreasurySettings> {
  const row = await prisma.platformSettings.findUnique({ where: { id: SETTINGS_ID } });
  return toSettings(row);
}

function normalizeSats(value: unknown, label: string): number {
  if (typeof value === "string" && value.trim() === "") {
    throw new Error(`${label} debe ser un número de sats`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} debe ser un número de sats`);
  const sats = Math.floor(n);
  if (sats < 1) throw new Error(`${label} debe ser al menos 1 sat`);
  if (sats > MAX_SATS_CAP) throw new Error(`${label} es demasiado grande`);
  return sats;
}

export async function updateTreasurySettings(input: {
  minSats?: unknown;
  maxSats?: unknown;
}): Promise<TreasurySettings> {
  const current = await getTreasurySettings();
  const minSats =
    input.minSats === undefined
      ? current.minSats
      : normalizeSats(input.minSats, "El mínimo");
  const maxSats =
    input.maxSats === undefined
      ? current.maxSats
      : normalizeSats(input.maxSats, "El máximo");
  if (minSats > maxSats) {
    throw new Error("El mínimo no puede ser mayor que el máximo");
  }

  const row = await prisma.platformSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, treasuryMinSats: minSats, treasuryMaxSats: maxSats },
    update: { treasuryMinSats: minSats, treasuryMaxSats: maxSats },
  });
  return toSettings(row);
}

export function treasurySettingsPayload(s: TreasurySettings) {
  return {
    minSats: s.minSats,
    maxSats: s.maxSats,
    updatedAt: s.updatedAt?.toISOString() ?? null,
    configured: s.configured,
  };
}
