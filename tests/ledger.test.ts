import { describe, it, expect } from "vitest";
import { poolBalances, canPayout, type EntryLike } from "@/lib/ledger-math";

const dep = (a: bigint, status = "settled"): EntryLike => ({
  kind: "deposit",
  amountMsat: a,
  status,
});
const out = (kind: string, a: bigint, status = "pending"): EntryLike => ({
  kind,
  amountMsat: a,
  status,
});

describe("poolBalances", () => {
  it("suma depósitos settled", () => {
    expect(poolBalances([dep(5000n), dep(5000n)]).deposited).toBe(10000n);
  });
  it("ignora depósitos no settled", () => {
    expect(poolBalances([dep(5000n, "pending")]).deposited).toBe(0n);
  });
  it("payout + fee dejan el pozo en cero", () => {
    const e = [dep(10000n), out("payout", 9500n), out("fee", 500n)];
    expect(poolBalances(e).available).toBe(0n);
  });
  it("ignora movimientos failed", () => {
    const e = [dep(10000n), out("payout", 9500n, "failed")];
    expect(poolBalances(e).available).toBe(10000n);
  });
});

describe("canPayout (invariante anti-insolvencia)", () => {
  it("permite hasta lo disponible", () => {
    expect(canPayout([dep(10000n)], 10000n)).toBe(true);
  });
  it("rechaza pagar de más (aunque sea 1 msat)", () => {
    expect(canPayout([dep(10000n)], 10001n)).toBe(false);
  });
  it("considera salidas ya comprometidas (pending)", () => {
    const e = [dep(10000n), out("payout", 9500n)];
    expect(canPayout(e, 600n)).toBe(false); // quedan 500
    expect(canPayout(e, 500n)).toBe(true);
  });
});
