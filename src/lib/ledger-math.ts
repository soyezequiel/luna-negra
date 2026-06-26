// Lógica PURA del ledger (sin DB) — testeable sin tocar Postgres.

export type LedgerKind =
  | "deposit"
  | "payout"
  | "refund"
  | "fee"
  | "dev_fee"
  | "forfeit";

export type EntryLike = { kind: string; amountMsat: bigint; status: string };

const OUTFLOW = new Set<string>(["payout", "refund", "fee", "dev_fee", "forfeit"]);

/** Balances del pozo de una apuesta a partir de sus movimientos. */
export function poolBalances(entries: EntryLike[]): {
  deposited: bigint;
  committedOut: bigint;
  available: bigint;
} {
  let deposited = 0n;
  let committedOut = 0n;
  for (const e of entries) {
    if (e.status === "failed") continue; // los fallidos no cuentan
    if (e.kind === "deposit") {
      if (e.status === "settled") deposited += e.amountMsat;
    } else if (OUTFLOW.has(e.kind)) {
      committedOut += e.amountMsat; // pending + settled = comprometido
    }
  }
  return { deposited, committedOut, available: deposited - committedOut };
}

/** Invariante anti-insolvencia: ¿se puede sacar `amountMsat` del pozo? */
export function canPayout(entries: EntryLike[], amountMsat: bigint): boolean {
  return poolBalances(entries).available >= amountMsat;
}
