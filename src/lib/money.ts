// Conversión de unidades. Apuestas/escrow trabajan en msat (BigInt);
// la tienda usa sats (Int). Siempre convertir en los bordes (R11).

export const MSAT_PER_SAT = 1000n;

export function satsToMsat(sats: number | bigint): bigint {
  return BigInt(sats) * MSAT_PER_SAT;
}

/** msat → sats redondeando hacia abajo (no se puede pagar sub-sat). */
export function msatToSats(msat: bigint): bigint {
  return msat / MSAT_PER_SAT;
}
