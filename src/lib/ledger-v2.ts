import { prisma } from "@/lib/prisma";
import { canPayout, type LedgerKind } from "@/lib/ledger-math";

// Ledger de apuestas v2 (zaps). Espejo exacto de src/lib/ledger.ts sobre la tabla
// ZapLedgerEntry: misma idempotencia por `idempotencyKey` (UNIQUE) y el mismo
// invariante anti-insolvencia (`canPayout`, puro y compartido con v1). La única
// diferencia es que cada movimiento puede referenciar su zap (9734 saliente /
// 9735) vía `zapRequestId` / `zapReceiptId`.

export type RecordResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate" | "insolvent" };

/**
 * Registra un movimiento SALIENTE (payout/refund/fee/dev_fee/forfeit) de forma
 * atómica: idempotente por `idempotencyKey` + respeta el invariante anti-insolvencia.
 * Devuelve el id del asiento (estado `pending`); el pago/zap real lo hace el caller
 * y luego marca `settled`/`failed` (y completa `zapRequestId`/`zapReceiptId`).
 */
export async function recordOutflowV2(params: {
  betId: string;
  userId: string | null;
  kind: Exclude<LedgerKind, "deposit">;
  amountMsat: bigint;
  idempotencyKey: string;
  zapRequestId?: string | null;
  paymentHash?: string | null;
}): Promise<RecordResult> {
  return prisma.$transaction(async (tx) => {
    const dup = await tx.zapLedgerEntry.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (dup) return { ok: false, reason: "duplicate" as const };

    const entries = await tx.zapLedgerEntry.findMany({
      where: { betId: params.betId },
      select: { kind: true, amountMsat: true, status: true },
    });
    if (!canPayout(entries, params.amountMsat)) {
      return { ok: false, reason: "insolvent" as const };
    }

    const created = await tx.zapLedgerEntry.create({
      data: {
        betId: params.betId,
        userId: params.userId,
        kind: params.kind,
        amountMsat: params.amountMsat,
        status: "pending",
        paymentHash: params.paymentHash ?? null,
        zapRequestId: params.zapRequestId ?? null,
        idempotencyKey: params.idempotencyKey,
      },
    });
    return { ok: true, id: created.id };
  });
}

/** Registra un depósito entrante (settled). Idempotente por `idempotencyKey`. */
export async function recordDepositV2(params: {
  betId: string;
  userId: string;
  amountMsat: bigint;
  idempotencyKey: string;
  paymentHash: string;
  zapRequestId?: string | null;
  zapReceiptId?: string | null;
}): Promise<RecordResult> {
  try {
    const created = await prisma.zapLedgerEntry.create({
      data: {
        betId: params.betId,
        userId: params.userId,
        kind: "deposit",
        amountMsat: params.amountMsat,
        status: "settled",
        paymentHash: params.paymentHash,
        zapRequestId: params.zapRequestId ?? null,
        zapReceiptId: params.zapReceiptId ?? null,
        idempotencyKey: params.idempotencyKey,
      },
    });
    return { ok: true, id: created.id };
  } catch {
    return { ok: false, reason: "duplicate" };
  }
}
