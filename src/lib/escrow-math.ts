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

/** Calcula pozo/comisión/neto de una apuesta. Determinista. */
export function computeEconomics(p: {
  stakeMsat: bigint;
  participantCount: number;
  feePct: number;
}): Economics {
  const potMsat = p.stakeMsat * BigInt(p.participantCount);
  const feeMsat = (potMsat * BigInt(p.feePct)) / 100n;
  return {
    potMsat,
    feeMsat,
    netMsat: potMsat - feeMsat,
    feeBps: p.feePct * 100,
  };
}

/**
 * Reparte el neto en partes iguales entre `winnerCount` ganadores.
 * El resto indivisible (`dust`, < winnerCount msat) lo retiene la casa con la
 * comisión (decisión de política; ver DEVELOPERS.md).
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
