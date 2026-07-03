// Configuración de apuestas v2 (zaps NIP-57). Los límites y plazos son los MISMOS
// que v1 (se re-exportan de escrow-config.ts para no divergir): stake, comisiones,
// piso anti-routing, ventanas de depósito/resolución/retiro y cadencia del tick.
// Acá solo viven los flags y el destino de fee PROPIOS de v2.

export {
  BET_MIN_SATS,
  BET_MAX_SATS,
  BET_MIN_MSAT,
  BET_MAX_MSAT,
  BET_FEE_PCT,
  BET_FEE_MIN_SATS,
  BET_FEE_MIN_MSAT,
  BET_FALLBACK_ROUTING_PCT,
  BET_MAX_ANONYMOUS_SEATS,
  DEPOSIT_WINDOW_MS,
  RESOLVE_WINDOW_MS,
  WITHDRAW_WINDOW_MS,
  ESCROW_TICK_INTERVAL_MS,
} from "./escrow-config";

// Flag maestro de v2. Con v2 conviviendo con v1, permite apagar el tick y los
// endpoints sin desplegar (default ON). "false" explícito lo desactiva.
export const BETS_V2_ENABLED = process.env.BETS_V2_ENABLED !== "false";

// El corte de la casa NO se paga: es la diferencia que queda en el pozo tras el
// ganador y el dev, y se retiene en el propio NWC de Luna Negra (asiento `fee`
// settled + registro en la nota de liquidación). Así los únicos movimientos
// salientes son los indispensables: premio del ganador y corte del dev.

// Cadencia del sync de recibos de payout (9735 emitidos por el wallet del
// receptor). Cierra la auditoría de los zaps salientes; no bloquea el pago.
export const ZAP_BET_SYNC_INTERVAL_MS = Number(
  process.env.ZAP_BET_SYNC_INTERVAL_MS ?? 60_000,
); // 60 s

// Tag `t` que marca los eventos Nostr de v2 (contrato y nota de liquidación),
// para poder filtrarlos en syncs/clientes sin confundirlos con los de v1.
export const BET_V2_CONTRACT_TAG = "lunanegra:bet:v2";
export const BET_V2_SETTLE_TAG = "lunanegra:settle:v2";
