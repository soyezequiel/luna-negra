import { describe, it, expect, beforeEach, vi } from "vitest";
import { nip19 } from "nostr-tools";

// ── Mocks de efectos colaterales (sin DB, sin Lightning, sin Nostr) ──
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/nostr", () => ({ fetchProfile: vi.fn(async () => null) }));

let configured = true;
const payAddrCalls: Array<{ dest: string; sats: number }> = [];
let payShouldThrow = false;
vi.mock("@/lib/lightning", () => ({
  lightningConfigured: () => configured,
  payToLightningAddress: vi.fn(async (dest: string, sats: number) => {
    payAddrCalls.push({ dest, sats });
    if (payShouldThrow) throw new Error("wallet offline");
    return "preimage-retry";
  }),
}));

// Estado de DB simulado.
const np1 = nip19.npubEncode("1".repeat(64));

let participant: Record<string, unknown> | null;
let ledgerFailed: Record<string, unknown> | null;
let poolEntries: Array<{ kind: string; amountMsat: bigint; status: string }>;
let userRow: Record<string, unknown> | null;

const ledgerUpdates: Array<Record<string, unknown>> = [];
const partUpdates: Array<Record<string, unknown>> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    betParticipant: {
      findUnique: vi.fn(async () => participant),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        partUpdates.push(data);
        return {};
      }),
    },
    ledgerEntry: {
      findFirst: vi.fn(async () => ledgerFailed),
      findMany: vi.fn(async () => poolEntries),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ledgerUpdates.push(data);
        return {};
      }),
    },
    user: {
      findUnique: vi.fn(async () => userRow),
    },
  },
}));

beforeEach(() => {
  configured = true;
  payShouldThrow = false;
  payAddrCalls.length = 0;
  ledgerUpdates.length = 0;
  partUpdates.length = 0;
  participant = {
    id: "p1",
    npub: np1,
    userId: "u1",
    betId: "bet1",
    payoutStatus: "failed",
    payoutMsat: 19_000n,
    bet: { id: "bet1" },
  };
  ledgerFailed = { id: "le1", kind: "payout", amountMsat: 19_000n, status: "failed" };
  // Pozo: 20000 depositado, fee 1000 → disponible 19000 (el payout failed no cuenta).
  poolEntries = [
    { kind: "deposit", amountMsat: 10_000n, status: "settled" },
    { kind: "deposit", amountMsat: 10_000n, status: "settled" },
    { kind: "fee", amountMsat: 1_000n, status: "settled" },
    { kind: "payout", amountMsat: 19_000n, status: "failed" },
  ];
  userRow = { lud16: "winner@example.com", payoutMethod: null };
});

describe("retryFailedPayout", () => {
  it("re-emite el pago sobre el asiento existente y marca paid", async () => {
    const { retryFailedPayout } = await import("@/lib/escrow-payout");
    const res = await retryFailedPayout("p1");
    expect(res).toBe("paid");
    expect(payAddrCalls).toEqual([{ dest: "winner@example.com", sats: 19 }]);
    expect(ledgerUpdates.at(-1)).toMatchObject({ status: "settled", paymentHash: "preimage-retry" });
    expect(partUpdates.at(-1)).toMatchObject({ payoutStatus: "paid", payoutDestination: "winner@example.com" });
  });

  it("si el pago vuelve a fallar, queda failed (sin tocar el asiento)", async () => {
    payShouldThrow = true;
    const { retryFailedPayout } = await import("@/lib/escrow-payout");
    const res = await retryFailedPayout("p1");
    expect(res).toBe("failed");
    expect(ledgerUpdates).toHaveLength(0);
    expect(partUpdates).toHaveLength(0);
  });

  it("sin destino → withdraw_pending (asiento a pending, sin pagar)", async () => {
    userRow = { lud16: null, payoutMethod: "nwc" };
    const { retryFailedPayout } = await import("@/lib/escrow-payout");
    const res = await retryFailedPayout("p1");
    expect(res).toBe("withdraw_pending");
    expect(payAddrCalls).toHaveLength(0);
    expect(ledgerUpdates.at(-1)).toMatchObject({ status: "pending" });
    expect(partUpdates.at(-1)).toMatchObject({ payoutStatus: "withdraw_pending" });
  });

  it("insolvente → skipped (no paga)", async () => {
    // Sin depósitos: disponible 0 < 19000.
    poolEntries = [{ kind: "payout", amountMsat: 19_000n, status: "failed" }];
    const { retryFailedPayout } = await import("@/lib/escrow-payout");
    const res = await retryFailedPayout("p1");
    expect(res).toBe("skipped");
    expect(payAddrCalls).toHaveLength(0);
  });

  it("participante no failed → skipped", async () => {
    participant = { ...participant!, payoutStatus: "paid" };
    const { retryFailedPayout } = await import("@/lib/escrow-payout");
    const res = await retryFailedPayout("p1");
    expect(res).toBe("skipped");
  });
});
