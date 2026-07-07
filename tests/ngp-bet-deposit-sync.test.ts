import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  zapBetFindUnique: vi.fn(),
  zapBetParticipantFindUnique: vi.fn(),
  checkAndSettleDepositV2: vi.fn(),
  settleDepositV2: vi.fn(),
  promoteIfAllPaidV2: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    zapBet: {
      findUnique: mocks.zapBetFindUnique,
    },
    zapBetParticipant: {
      findUnique: mocks.zapBetParticipantFindUnique,
    },
  },
}));

vi.mock("@/lib/zap-bet", () => ({
  checkAndSettleDepositV2: mocks.checkAndSettleDepositV2,
  settleDepositV2: mocks.settleDepositV2,
  promoteIfAllPaidV2: mocks.promoteIfAllPaidV2,
}));

import {
  isNgpContractId,
  syncNgpBetDepositsByContract,
  settleNgpBetDepositByPaymentHash,
} from "@/lib/ngp-bet-deposit-sync";

describe("ngp bet deposit sync", () => {
  beforeEach(() => {
    mocks.zapBetFindUnique.mockReset();
    mocks.zapBetParticipantFindUnique.mockReset();
    mocks.checkAndSettleDepositV2.mockReset();
    mocks.settleDepositV2.mockReset();
    mocks.promoteIfAllPaidV2.mockReset();
    globalThis.lunaNgpDepositSyncAt?.clear();
  });

  it("acepta solo ids de contrato NGP hex de 64 chars", () => {
    expect(isNgpContractId("a".repeat(64))).toBe(true);
    expect(isNgpContractId("A".repeat(64))).toBe(true);
    expect(isNgpContractId("a".repeat(63))).toBe(false);
    expect(isNgpContractId("z".repeat(64))).toBe(false);
  });

  it("chequea solo participantes pendientes con invoice real", async () => {
    mocks.zapBetFindUnique.mockResolvedValue({
      id: "bet-1",
      status: "pending_deposits",
      participants: [
        { id: "p1", depositStatus: "pending", depositPaymentHash: "hash-1" },
        { id: "p2", depositStatus: "paid", depositPaymentHash: "hash-2" },
        { id: "p3", depositStatus: "pending", depositPaymentHash: null },
        { id: "p4", depositStatus: "pending", depositPaymentHash: "dev-hash" },
      ],
    });
    mocks.checkAndSettleDepositV2.mockResolvedValue(true);

    const result = await syncNgpBetDepositsByContract("a".repeat(64));

    expect(result).toMatchObject({ found: true, betId: "bet-1", checked: 1, settled: 1 });
    expect(mocks.checkAndSettleDepositV2).toHaveBeenCalledTimes(1);
    expect(mocks.checkAndSettleDepositV2).toHaveBeenCalledWith("p1");
  });

  it("throttlea lookups repetidos del mismo participante", async () => {
    mocks.zapBetFindUnique.mockResolvedValue({
      id: "bet-1",
      status: "pending_deposits",
      participants: [{ id: "p1", depositStatus: "pending", depositPaymentHash: "hash-1" }],
    });
    mocks.checkAndSettleDepositV2.mockResolvedValue(false);

    await syncNgpBetDepositsByContract("a".repeat(64));
    const result = await syncNgpBetDepositsByContract("a".repeat(64));

    expect(result).toMatchObject({ checked: 0, settled: 0, throttled: 1 });
    expect(mocks.checkAndSettleDepositV2).toHaveBeenCalledTimes(1);
  });

  it("settlea directo por payment_hash cuando llega una notification NWC", async () => {
    const bet = { id: "bet-1", status: "pending_deposits" };
    const part = {
      id: "p1",
      betId: "bet-1",
      depositStatus: "pending",
      depositPaymentHash: "hash-1",
      bet,
    };
    mocks.zapBetParticipantFindUnique.mockResolvedValue(part);

    const settled = await settleNgpBetDepositByPaymentHash("hash-1", "webhook");

    expect(settled).toBe(true);
    expect(mocks.settleDepositV2).toHaveBeenCalledWith(bet, part, expect.any(Date), "webhook");
    expect(mocks.promoteIfAllPaidV2).toHaveBeenCalledWith("bet-1", expect.any(Date));
    expect(mocks.checkAndSettleDepositV2).not.toHaveBeenCalled();
  });
});
