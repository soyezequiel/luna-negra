// Vistas PÚBLICAS del estado interno de una apuesta — la única tabla a mantener.
//
// El mismo estado interno (bet-state.ts) se traduce distinto según el borde:
//  - `nge`: estado público del RPC NGE (spec docs/nge/nge-v2-spec.md §7).
//  - `rest`: estado público de la API REST v1/v2 (docs/api-publica.md).
//  - `ngp`: estado de la sombra 31340 (docs/nostr-games-protocol-apuestas.md §4);
//    `null` = transición que no se publica (el terminal llega enseguida y el
//    intermedio solo mete ruido en relays).
//
// Antes estas tres traducciones vivían en switches separados (nge-service,
// escrow-math, ngp-bet-state) y era fácil desincronizarlas al agregar un estado.
// Acá agregar un estado interno OBLIGA a completar la fila entera.

export type NgpPublicStatus = { status: string; reason?: string } | null;

type StatusViews = { nge: string; rest: string; ngp: NgpPublicStatus };

const STATUS_VIEWS: Record<string, StatusViews> = {
  created: {
    nge: "pending_deposits",
    rest: "pending_deposits",
    ngp: { status: "accepted" },
  },
  pending_deposits: {
    nge: "pending_deposits",
    rest: "pending_deposits",
    ngp: { status: "accepted" },
  },
  ready: { nge: "funded", rest: "funded", ngp: { status: "funded" } },
  settling: { nge: "resolving", rest: "funded", ngp: null },
  refunding: { nge: "resolving", rest: "refunded", ngp: null },
  settled: { nge: "settled", rest: "settled", ngp: { status: "resolved" } },
  cancelled_admin: {
    nge: "cancelled",
    rest: "cancelled",
    ngp: { status: "void", reason: "cancelled" },
  },
  cancelled_incomplete: {
    nge: "expired",
    rest: "expired",
    ngp: { status: "expired", reason: "deposit_timeout" },
  },
  refunded_timeout: {
    nge: "refunded",
    rest: "refunded",
    ngp: { status: "void", reason: "resolve_timeout" },
  },
  voided: { nge: "refunded", rest: "refunded", ngp: { status: "void", reason: "oracle_void" } },
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

/** Estado interno → estado NGP de la sombra 31340 (`null` = no se publica). */
export function ngpStatusFor(internal: string): NgpPublicStatus {
  return STATUS_VIEWS[internal]?.ngp ?? null;
}
