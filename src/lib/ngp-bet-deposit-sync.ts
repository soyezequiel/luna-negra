import { prisma } from "@/lib/prisma";
import { checkAndSettleDepositV2 } from "@/lib/zap-bet";

export const NGP_DEPOSIT_SYNC_MIN_MS = 1500;

declare global {
  // Throttle compartido por proceso: cada lookup NWC cuesta red y no queremos que
  // varios clientes refrescando la misma apuesta multipliquen consultas idénticas.
  var lunaNgpDepositSyncAt: Map<string, number> | undefined;
}

const lastDepositSyncAt = (globalThis.lunaNgpDepositSyncAt ??= new Map<string, number>());

export function isNgpContractId(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export type NgpDepositSyncResult = {
  found: boolean;
  betId: string | null;
  status: string | null;
  checked: number;
  settled: number;
  throttled: number;
};

export async function syncNgpBetDepositsByContract(
  contractId: string,
): Promise<NgpDepositSyncResult> {
  const bet = await prisma.zapBet.findUnique({
    where: { anchorEventId: contractId },
    select: {
      id: true,
      status: true,
      participants: {
        select: {
          id: true,
          depositStatus: true,
          depositPaymentHash: true,
        },
      },
    },
  });

  if (!bet) {
    return { found: false, betId: null, status: null, checked: 0, settled: 0, throttled: 0 };
  }
  if (bet.status !== "pending_deposits") {
    return { found: true, betId: bet.id, status: bet.status, checked: 0, settled: 0, throttled: 0 };
  }

  const now = Date.now();
  let throttled = 0;
  const due = bet.participants
    .filter(
      (p) =>
        p.depositStatus === "pending" &&
        !!p.depositPaymentHash &&
        !p.depositPaymentHash.startsWith("dev-"),
    )
    .filter((p) => {
      const last = lastDepositSyncAt.get(p.id) ?? 0;
      if (now - last < NGP_DEPOSIT_SYNC_MIN_MS) {
        throttled += 1;
        return false;
      }
      lastDepositSyncAt.set(p.id, now);
      return true;
    });

  const settled = await Promise.all(due.map((p) => checkAndSettleDepositV2(p.id)));
  return {
    found: true,
    betId: bet.id,
    status: bet.status,
    checked: due.length,
    settled: settled.filter(Boolean).length,
    throttled,
  };
}
