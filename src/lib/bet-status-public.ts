// Vistas PÚBLICAS del estado interno de una apuesta — la única tabla a mantener.
//
// El mismo estado interno (bet-state.ts) se traduce distinto según el borde:
//  - `nge`: estado público del RPC NGE (spec docs/nge/nge-v2-spec.md §7).
//  - `rest`: estado público de la API REST v1/v2 (docs/api-publica.md).
//
// Antes estas traducciones vivían en switches separados (nge-service,
// escrow-math) y era fácil desincronizarlas al agregar un estado. Acá agregar un
// estado interno OBLIGA a completar la fila entera.

type StatusViews = { nge: string; rest: string };

const STATUS_VIEWS: Record<string, StatusViews> = {
  created: { nge: "pending_deposits", rest: "pending_deposits" },
  pending_deposits: { nge: "pending_deposits", rest: "pending_deposits" },
  ready: { nge: "funded", rest: "funded" },
  settling: { nge: "resolving", rest: "funded" },
  refunding: { nge: "resolving", rest: "refunded" },
  settled: { nge: "settled", rest: "settled" },
  cancelled_admin: { nge: "cancelled", rest: "cancelled" },
  cancelled_incomplete: { nge: "expired", rest: "expired" },
  refunded_timeout: { nge: "refunded", rest: "refunded" },
  voided: { nge: "refunded", rest: "refunded" },
};

/** Estado interno del motor → estado público NGE (spec §7). */
export function ngeStatus(internal: string): string {
  return STATUS_VIEWS[internal]?.nge ?? internal;
}

/**
 * Estado público NGE de una apuesta concreta: como `ngeStatus`, pero una
 * apuesta fondeada con resultado fijado esperando la ventana de disputa
 * (spec §7.1: `ready` + `settleAt`) se reporta como `resolving`.
 */
export function ngeStatusOf(bet: { status: string; settleAt?: Date | null }): string {
  if (bet.status === "ready" && bet.settleAt) return "resolving";
  return ngeStatus(bet.status);
}

/**
 * Estado interno → estado público de la API REST v1/v2. Los estados internos NO
 * se renombran (romperían el tick/admin); se traducen en el borde de la API.
 */
export function publicBetStatus(internal: string): string {
  return STATUS_VIEWS[internal]?.rest ?? internal;
}
