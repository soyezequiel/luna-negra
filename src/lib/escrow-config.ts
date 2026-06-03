import { satsToMsat } from "./money";

// Límites y parámetros de la beta. Configurables por env.
export const BET_MIN_SATS = Number(process.env.BET_MIN_SATS ?? 5);
export const BET_MAX_SATS = Number(process.env.BET_MAX_SATS ?? 100);
export const BET_MIN_MSAT = satsToMsat(BET_MIN_SATS);
export const BET_MAX_MSAT = satsToMsat(BET_MAX_SATS);

// Fee de Luna Negra (lo fija Luna Negra, NO el proveedor).
export const BET_FEE_PCT = Number(process.env.BET_FEE_PCT ?? 5);

// Plazos.
export const DEPOSIT_WINDOW_MS = 10 * 60 * 1000; // 10 min
export const RESOLVE_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const WITHDRAW_WINDOW_MS = 60 * 60 * 1000; // 60 min
