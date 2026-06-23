import { satsToMsat } from "./money";

// Límites y parámetros de la beta. Configurables por env.
export const BET_MIN_SATS = Number(process.env.BET_MIN_SATS ?? 5);
export const BET_MAX_SATS = Number(process.env.BET_MAX_SATS ?? 100);
export const BET_MIN_MSAT = satsToMsat(BET_MIN_SATS);
export const BET_MAX_MSAT = satsToMsat(BET_MAX_SATS);

// Fee de Luna Negra (lo fija Luna Negra, NO el proveedor).
export const BET_FEE_PCT = Number(process.env.BET_FEE_PCT ?? 5);

// Comisión mínima ABSOLUTA en sats. En apuestas chicas el % puede quedar por
// debajo del costo de routing de Lightning al pagar el premio y dejar a la casa
// en rojo (ej. 5% de un pozo de 12 sats = 0,6 sats < routing). Este piso asegura
// que cada apuesta liquidada con ganador retenga al menos esto. Se aplica como
// max(%, piso) y nunca supera el pozo (el neto nunca queda negativo). 0 = sin piso.
export const BET_FEE_MIN_SATS = Number(process.env.BET_FEE_MIN_SATS ?? 1);
export const BET_FEE_MIN_MSAT = satsToMsat(BET_FEE_MIN_SATS);

// Apuestas anónimas (sin cuentas Nostr): un juego puede crear una apuesta para N
// "asientos" anónimos (ej. un duelo 1v1 en la misma compu, en un stand). Luna
// Negra genera una identidad efímera por asiento y el ganador cobra por
// LNURL-withdraw (no tiene wallet asociada). Tope para evitar abuso.
export const BET_MAX_ANONYMOUS_SEATS = Number(process.env.BET_MAX_ANONYMOUS_SEATS ?? 8);

// Plazos.
export const DEPOSIT_WINDOW_MS = 10 * 60 * 1000; // 10 min
export const RESOLVE_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const WITHDRAW_WINDOW_MS = 60 * 60 * 1000; // 60 min

// Cadencia del tick de escrow corriendo IN-PROCESS (self-host, sin QStash). El
// scheduler vive en src/instrumentation.ts. 0 = desactivado (ej. si en su lugar
// se usa un cron externo que pega a /api/escrow/tick). Ver docs/qstash-setup.md.
export const ESCROW_TICK_INTERVAL_MS = Number(
  process.env.ESCROW_TICK_INTERVAL_MS ?? 60_000,
); // 60 s
