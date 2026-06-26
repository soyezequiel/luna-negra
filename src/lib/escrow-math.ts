// Lógica PURA de la economía de una apuesta (sin DB) — testeable sin Postgres.
// Centraliza el cálculo del pozo, la comisión, el neto y el reparto entre
// ganadores. El route de resultado y los views v1 la reusan para no divergir.

export type Economics = {
  /** Pozo total = stake por jugador × participantes (msat). */
  potMsat: bigint;
  /** Comisión de Luna Negra sobre el pozo (msat). */
  feeMsat: bigint;
  /** Neto que se reparte entre ganadores = pozo − comisión (msat). */
  netMsat: bigint;
  /** Comisión en basis points (feePct × 100), para clientes. */
  feeBps: number;
};

/**
 * Calcula pozo/comisión/neto de una apuesta. Determinista.
 *
 * `feeMinMsat` (opcional) es un piso ABSOLUTO: la comisión efectiva es
 * `max(pozo×feePct%, feeMinMsat)`, acotada al pozo entero para no dejar el neto
 * negativo. Sirve para que apuestas chicas no queden en rojo por el routing de
 * Lightning (ver BET_FEE_MIN_SATS). Cuando el piso aplica, `feeBps` refleja la
 * tasa EFECTIVA (no `feePct`), para no engañar al cliente.
 */
export function computeEconomics(p: {
  stakeMsat: bigint;
  participantCount: number;
  feePct: number;
  feeMinMsat?: bigint;
}): Economics {
  const potMsat = p.stakeMsat * BigInt(p.participantCount);
  const pctMsat = (potMsat * BigInt(p.feePct)) / 100n;
  const floor = p.feeMinMsat ?? 0n;
  // max(%, piso), pero nunca más que el pozo (neto ≥ 0).
  const raw = pctMsat < floor ? floor : pctMsat;
  const feeMsat = raw > potMsat ? potMsat : raw;
  return {
    potMsat,
    feeMsat,
    netMsat: potMsat - feeMsat,
    // bps efectivos sobre el pozo (coincide con feePct×100 si el piso no aplica).
    feeBps: potMsat > 0n ? Number((feeMsat * 10000n) / potMsat) : 0,
  };
}

/**
 * Reserva (msat) para cubrir el routing Lightning de UN payout de `payoutMsat`
 * cuando se paga por el wallet de fallback (ej. Rizful). Modela el algoritmo de
 * fee inferido del fallback: piso de 1 sat + `pct`% del monto, SIEMPRE redondeado
 * hacia arriba al sat entero (el fallback cobra sats enteros). Determinista.
 *   reserva = max(1 sat, ceil_a_sat(payout × pct%))
 */
export function routingReserveMsat(payoutMsat: bigint, pct: number): bigint {
  if (payoutMsat <= 0n) return 0n;
  const payoutSats = Number(payoutMsat / 1000n); // montos chicos: seguro en Number
  const reserveSats = Math.max(1, Math.ceil((payoutSats * pct) / 100));
  return BigInt(reserveSats) * 1000n;
}

/**
 * Reparte el neto en partes iguales entre `winnerCount` ganadores.
 * El resto indivisible (`dust`, < winnerCount msat) lo retiene la casa con la
 * comisión (decisión de política; ver docs/api-publica.md).
 */
export function splitWinnings(
  netMsat: bigint,
  winnerCount: number,
): { perWinner: bigint; dust: bigint } {
  if (winnerCount <= 0) return { perWinner: 0n, dust: netMsat };
  const perWinner = netMsat / BigInt(winnerCount);
  return { perWinner, dust: netMsat - perWinner * BigInt(winnerCount) };
}

/**
 * Mapea el estado interno del Bet al estado PÚBLICO que ven los proveedores en
 * la API v1. Los estados internos NO se renombran (romperían el tick/admin);
 * se traducen en el borde de la API.
 */
export function publicBetStatus(internal: string): string {
  switch (internal) {
    case "created":
    case "pending_deposits":
      return "pending_deposits";
    case "ready":
    case "settling":
      return "funded";
    case "settled":
      return "settled";
    case "cancelled_admin":
      return "cancelled";
    case "cancelled_incomplete":
      return "expired";
    case "refunding":
    case "refunded_timeout":
    case "voided":
      return "refunded";
    default:
      return internal;
  }
}
