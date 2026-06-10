// Etiquetas y colores de acento para mostrar apuestas en la UI.
// Sistema de color: btc=en juego (dinero en escrow), verde=ganada, rojo=perdida,
// gris=espera/cancelada. Compartido por /bets, bet-view y la ficha del juego.

export const BET_STATUS_LABEL: Record<string, string> = {
  created: "Creada",
  pending_deposits: "Esperando depósitos",
  ready: "En juego",
  settling: "Liquidando",
  settled: "Resuelta",
  refunding: "Reembolsando",
  cancelled_incomplete: "Cancelada",
  cancelled_admin: "Cancelada",
  refunded_timeout: "Reembolsada",
  voided: "Anulada",
};

/** Apuestas con sats retenidos en escrow (cuentan como "en juego ahora"). */
export const ACTIVE_BET_STATUSES = new Set([
  "created",
  "pending_deposits",
  "ready",
  "settling",
  "refunding",
]);

export type BetTone = "active" | "won" | "lost" | "tie" | "waiting" | "void";

/** Tono visual a partir del estado de la apuesta y el resultado del jugador. */
export function betTone(status: string, result?: string | null): BetTone {
  if (status === "settled") {
    if (result === "won") return "won";
    if (result === "tie") return "tie";
    return "lost";
  }
  if (status === "ready" || status === "settling") return "active";
  if (status === "pending_deposits" || status === "created") return "waiting";
  return "void";
}

/** Color de acento (variable CSS) por tono, para la barra izquierda de la fila. */
export function toneAccent(tone: BetTone): string {
  switch (tone) {
    case "won":
    case "tie":
      return "var(--win)";
    case "lost":
      return "var(--lose)";
    case "active":
    case "waiting":
      return "var(--btc)";
    case "void":
    default:
      return "var(--faint)";
  }
}

export function betStatusLabel(status: string): string {
  return BET_STATUS_LABEL[status] ?? status;
}
