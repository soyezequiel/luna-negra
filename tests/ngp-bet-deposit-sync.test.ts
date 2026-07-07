import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  checkAndSettleDepositV2: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    zapBet: {
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock("@/lib/zap-bet", () => ({
  checkAndSettleDepositV2: mocks.checkAndSettleDepositV2,
}));

import {
  isNgpContractId,
  syncNgpBetDepositsByContract,
} from "@/lib/ngp-bet-deposit-sync";

describe("ngp bet deposit sync", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.checkAndSettleDepositV2.mockReset();
    globalThis.lunaNgpDepositSyncAt?.clear();
  });

  it("acepta solo ids de contrato NGP hex de 64 chars", () => {
    expect(isNgpContractId("a".repeat(64))).toBe(true);
    expect(isNgpContractId("A".repeat(64))).toBe(true);
    expect(isNgpContractId("a".repeat(63))).toBe(false);
    expect(isNgpContractId("z".repeat(64))).toBe(false);
  });

  it("chequea solo participantes pendientes con invoice real", async () => {
    mocks.findUnique.mockResolvedValue({
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
    mocks.findUnique.mockResolvedValue({
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
});
