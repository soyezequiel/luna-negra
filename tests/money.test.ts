import { describe, it, expect } from "vitest";
import { satsToMsat, msatToSats, MSAT_PER_SAT } from "@/lib/money";

describe("money", () => {
  it("sats → msat", () => {
    expect(satsToMsat(5)).toBe(5000n);
    expect(satsToMsat(100)).toBe(100000n);
  });
  it("msat → sats (floor)", () => {
    expect(msatToSats(5500n)).toBe(5n);
    expect(msatToSats(999n)).toBe(0n);
  });
  it("roundtrip exacto", () => {
    expect(msatToSats(satsToMsat(100))).toBe(100n);
  });
  it("MSAT_PER_SAT = 1000", () => {
    expect(MSAT_PER_SAT).toBe(1000n);
  });
});
