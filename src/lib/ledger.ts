import { prisma } from "@/lib/prisma";
import { canPayout, type LedgerKind } from "@/lib/ledger-math";

export type RecordResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate" | "insolvent" };

/**
 * Registra un movimiento SALIENTE (payout/refund/fee/forfeit) de forma atómica:
 * - idempotente por `idempotencyKey` (UNIQUE en DB)
 * - respeta el invariante anti-insolvencia (no sacar más de lo disponible)
 * Devuelve el id del LedgerEntry (estado `pending`); el pago real lo hace el caller
 * y luego marca `settled`/`failed`.
 */
export async function recordOutflow(params: {
  betId: string;
  userId: string | null;
  kind: Exclude<LedgerKind, "deposit">;
  amountMsat: bigint;
  idempotencyKey: string;
  paymentHash?: string;
}): Promise<RecordResult> {
  return prisma.$transaction(async (tx) => {
    const dup = await tx.ledgerEntry.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (dup) return { ok: false, reason: "duplicate" as const };

    const entries = await tx.ledgerEntry.findMany({
      where: { betId: params.betId },
      select: { kind: true, amountMsat: true, status: true },
    });
    if (!canPayout(entries, params.amountMsat)) {
      return { ok: false, reason: "insolvent" as const };
    }

    const created = await tx.ledgerEntry.create({
      data: {
        betId: params.betId,
        userId: params.userId,
        kind: params.kind,
        amountMsat: params.amountMsat,
        status: "pending",
        paymentHash: params.paymentHash ?? null,
        idempotencyKey: params.idempotencyKey,
      },
    });
    return { ok: true, id: created.id };
  });
}

/** Registra un depósito entrante (settled). Idempotente por `idempotencyKey`. */
export async function recordDeposit(params: {
  betId: string;
  userId: string;
  amountMsat: bigint;
  idempotencyKey: string;
  paymentHash: string;
}): Promise<RecordResult> {
  try {
    const created = await prisma.ledgerEntry.create({
      data: {
        betId: params.betId,
        userId: params.userId,
        kind: "deposit",
        amountMsat: params.amountMsat,
        status: "settled",
        paymentHash: params.paymentHash,
        idempotencyKey: params.idempotencyKey,
      },
    });
    return { ok: true, id: created.id };
  } catch {
    return { ok: false, reason: "duplicate" };
  }
}
