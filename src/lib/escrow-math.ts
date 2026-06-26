// Lógica PURA de la economía de una apuesta (sin DB) — testeable sin Postgres.
// Centraliza el cálculo del pozo, la comisión, el neto y el reparto entre
// ganadores. El route de resultado y los views v1 la reusan para no divergir.

export type Economics = {
  /** Pozo total = stake por jugador × participantes (msat). */
  potMsat: bigint;
  /** Comisión de Luna Negra (la casa) sobre el pozo (msat). */
  feeMsat: bigint;
  /** Corte del dev (proveedor) sobre el pozo (msat). Se SUMA al de la casa. */
  devFeeMsat: bigint;
  /** Neto que se reparte entre ganadores = pozo − comisión casa − corte dev (msat). */
  netMsat: bigint;
  /** Comisión de la casa en basis points efectivos sobre el pozo, para clientes. */
  feeBps: number;
  /** Corte del dev en basis points efectivos sobre el pozo, para clientes. */
  devFeeBps: number;
};

/**
 * Calcula pozo/comisiones/neto de una apuesta. Determinista.
 *
 * Hay DOS cortes ADITIVOS sobre el pozo: el de la casa (`feePct`) y el del dev
 * (`devFeePct`). El neto del ganador es el pozo menos ambos.
 *
 * `feeMinMsat` (opcional) es un piso ABSOLUTO para la comisión de la CASA: su
 * comisión efectiva es `max(pozo×feePct%, feeMinMsat)`, acotada al pozo. Sirve
 * para que apuestas chicas no queden en rojo por el routing de Lightning (ver
 * BET_FEE_MIN_SATS). La casa cobra PRIMERO (su piso tiene prioridad); el corte
 * del dev se acota a lo que sobra, para no dejar el neto negativo. Cuando un piso
 * aplica, `feeBps`/`devFeeBps` reflejan la tasa EFECTIVA, no la nominal.
 */
export function computeEconomics(p: {
  stakeMsat: bigint;
  participantCount: number;
  feePct: number;
  devFeePct?: number;
  feeMinMsat?: bigint;
}): Economics {
  const potMsat = p.stakeMsat * BigInt(p.participantCount);
  // 1) Comisión de la casa: max(%, piso), acotada al pozo (neto ≥ 0).
  const pctMsat = (potMsat * BigInt(p.feePct)) / 100n;
  const floor = p.feeMinMsat ?? 0n;
  const rawHouse = pctMsat < floor ? floor : pctMsat;
  const feeMsat = rawHouse > potMsat ? potMsat : rawHouse;
  // 2) Corte del dev: % del pozo, pero acotado a lo que queda tras la casa.
  const remaining = potMsat - feeMsat;
  const devPctMsat = (potMsat * BigInt(p.devFeePct ?? 0)) / 100n;
  const devFeeMsat = devPctMsat > remaining ? remaining : devPctMsat;
  const bps = (msat: bigint) => (potMsat > 0n ? Number((msat * 10000n) / potMsat) : 0);
  return {
    potMsat,
    feeMsat,
    devFeeMsat,
    netMsat: potMsat - feeMsat - devFeeMsat,
    feeBps: bps(feeMsat),
    devFeeBps: bps(devFeeMsat),
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
