// Máquina de estados de una apuesta. Las transiciones se validan con esto
// dentro de las transacciones (el claim optimista usa el estado origen).

export const BET_TRANSITIONS: Record<string, readonly string[]> = {
  created: ["pending_deposits", "cancelled_admin"],
  pending_deposits: ["ready", "refunding", "cancelled_admin"],
  ready: ["settling", "refunding"],
  settling: ["settled"],
  refunding: ["cancelled_incomplete", "cancelled_admin", "refunded_timeout"],
  settled: [],
  cancelled_incomplete: [],
  cancelled_admin: [],
  refunded_timeout: [],
};

export function canTransition(from: string, to: string): boolean {
  return BET_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: string): boolean {
  return (BET_TRANSITIONS[status]?.length ?? 0) === 0;
}
