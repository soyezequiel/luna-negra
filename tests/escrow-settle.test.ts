import { describe, it, expect, beforeEach, vi } from "vitest";
import { nip19 } from "nostr-tools";
import { computeContractHash } from "@/lib/escrow";

// ── Mocks de efectos colaterales (sin DB, sin relays, sin Lightning) ──
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

const payCalls: Array<{ npub: string; amountMsat: bigint; kind: string }> = [];
const devFeeCalls: Array<{ amountMsat: bigint }> = [];
vi.mock("@/lib/escrow-payout", () => ({
  payParticipant: vi.fn(async (args: { participant: { npub: string }; amountMsat: bigint; kind: string }) => {
    payCalls.push({ npub: args.participant.npub, amountMsat: args.amountMsat, kind: args.kind });
  }),
  payProviderFee: vi.fn(async (args: { amountMsat: bigint }) => {
    devFeeCalls.push({ amountMsat: args.amountMsat });
  }),
}));

const published: unknown[] = [];
vi.mock("@/lib/nostr-server", () => ({
  publishSignedEvent: vi.fn(async (ev: unknown) => { published.push(ev); }),
}));

const settled: string[] = [];
const refunded: Array<{ betId: string; reason: string }> = [];
vi.mock("@/lib/webhooks", () => ({
  emitBetSettled: vi.fn(async (betId: string) => { settled.push(betId); }),
  emitBetRefunded: vi.fn(async (betId: string, reason: string) => { refunded.push({ betId, reason }); }),
}));

vi.mock("@/lib/ledger", () => ({
  recordOutflow: vi.fn(async () => ({ ok: true })),
}));

// Estado de DB simulado: solo lo que toca el núcleo.
let claimCount = 1; // cuántas filas gana el claim ready→settling
const betUpdates: Array<Record<string, unknown>> = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bet: {
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // El rollback (settling→ready) no cuenta como claim.
        if (data.status === "settling") return { count: claimCount };
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        betUpdates.push(data);
        return {};
      }),
    },
    betParticipant: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    ledgerEntry: {
      update: vi.fn(async () => ({})),
    },
  },
}));

const np1 = nip19.npubEncode("1".repeat(64));
const np2 = nip19.npubEncode("2".repeat(64));
const np3 = nip19.npubEncode("3".repeat(64));

type Part = { id: string; npub: string; userId: string };

function makeBet(over: Partial<Record<string, unknown>> = {}) {
  const participants: Part[] = [
    { id: "p1", npub: np1, userId: "u1" },
    { id: "p2", npub: np2, userId: "u2" },
  ];
  const base = {
    id: "bet1",
    gameId: "g1",
    providerId: "prov1",
    status: "ready",
    stakeMsat: 10_000n,
    feePct: 5,
    victoryCondition: "mayor puntaje",
    contractHash: null as string | null,
    participants,
    provider: { id: "prov1", oraclePubkey: "abc", owner: { pubkey: "abc" } },
  };
  return { ...base, ...over } as never;
}

const fakeEvent = { id: "evt1", pubkey: "abc" } as never;

beforeEach(() => {
  claimCount = 1;
  payCalls.length = 0;
  devFeeCalls.length = 0;
  published.length = 0;
  settled.length = 0;
  refunded.length = 0;
  betUpdates.length = 0;
});

describe("settleBetWithResult", () => {
  it("un ganador: cobra el pozo neto (pozo − fee)", async () => {
    const { settleBetWithResult } = await import("@/lib/escrow-settle");
    const r = await settleBetWithResult({
      bet: makeBet(),
      winnerNpubs: [np1],
      resultEvent: fakeEvent,
    });
    expect(r.ok).toBe(true);
    // pozo = 20000, fee 5% = 1000, neto = 19000 a un ganador.
    expect(payCalls).toEqual([{ npub: np1, amountMsat: 19_000n, kind: "payout" }]);
    expect(betUpdates.at(-1)).toMatchObject({ status: "settled", resultEventId: "evt1" });
    expect(settled).toEqual(["bet1"]);
    expect(published).toHaveLength(1);
    // Sin corte del dev (devFeePct 0) → no se paga al proveedor.
    expect(devFeeCalls).toHaveLength(0);
  });

  it("con corte del dev: paga al proveedor y descuenta del neto del ganador", async () => {
    const { settleBetWithResult } = await import("@/lib/escrow-settle");
    const r = await settleBetWithResult({
      bet: makeBet({ devFeePct: 3 }),
      winnerNpubs: [np1],
      resultEvent: fakeEvent,
    });
    expect(r.ok).toBe(true);
    // pozo = 20000, casa 5% = 1000, dev 3% = 600, neto = 18400 al ganador.
    expect(devFeeCalls).toEqual([{ amountMsat: 600n }]);
    expect(payCalls).toEqual([{ npub: np1, amountMsat: 18_400n, kind: "payout" }]);
  });

  it("varios ganadores: divide el neto en partes iguales", async () => {
    const { settleBetWithResult } = await import("@/lib/escrow-settle");
    const bet = makeBet({
      participants: [
        { id: "p1", npub: np1, userId: "u1" },
        { id: "p2", npub: np2, userId: "u2" },
        { id: "p3", npub: np3, userId: "u3" },
      ],
    });
    const r = await settleBetWithResult({ bet, winnerNpubs: [np1, np2], resultEvent: fakeEvent });
    expect(r.ok).toBe(true);
    // pozo = 30000, fee 5% = 1500, neto = 28500 / 2 = 14250 c/u.
    expect(payCalls).toEqual([
      { npub: np1, amountMsat: 14_250n, kind: "payout" },
      { npub: np2, amountMsat: 14_250n, kind: "payout" },
    ]);
  });

  it("sin ganadores (void): reembolsa el stake completo a todos, sin fee", async () => {
    const { settleBetWithResult } = await import("@/lib/escrow-settle");
    const r = await settleBetWithResult({
      bet: makeBet(),
      winnerNpubs: [],
      resultEvent: fakeEvent,
    });
    expect(r).toEqual({ ok: true, voided: true });
    expect(payCalls).toEqual([
      { npub: np1, amountMsat: 10_000n, kind: "refund" },
      { npub: np2, amountMsat: 10_000n, kind: "refund" },
    ]);
    expect(betUpdates.at(-1)).toMatchObject({ status: "voided" });
    expect(refunded).toEqual([{ betId: "bet1", reason: "void" }]);
  });

  it("ya resuelta → idempotente: éxito no-op, no paga", async () => {
    const { settleBetWithResult } = await import("@/lib/escrow-settle");
    const r = await settleBetWithResult({
      bet: makeBet({ status: "settled" }),
      winnerNpubs: [np1],
      resultEvent: fakeEvent,
    });
    expect(r).toMatchObject({ ok: true, alreadyResolved: true, finalStatus: "settled" });
    expect(payCalls).toHaveLength(0);
  });

  it("reembolsada/cancelada → idempotente: éxito no-op, no paga", async () => {
    const { settleBetWithResult } = await import("@/lib/escrow-settle");
    const r = await settleBetWithResult({
      bet: makeBet({ status: "refunded_timeout" }),
      winnerNpubs: [np1],
      resultEvent: fakeEvent,
    });
    expect(r).toMatchObject({ ok: true, alreadyResolved: true, finalStatus: "refunded" });
    expect(payCalls).toHaveLength(0);
  });

  it("perdió la carrera del claim → NOT_READY", async () => {
    const { settleBetWithResult } = await import("@/lib/escrow-settle");
    claimCount = 0;
    const r = await settleBetWithResult({
      bet: makeBet(),
      winnerNpubs: [np1],
      resultEvent: fakeEvent,
    });
    expect(r).toMatchObject({ ok: false, code: "NOT_READY", status: 409 });
    expect(payCalls).toHaveLength(0);
  });

  it("términos alterados → CONTRACT_MISMATCH (no paga)", async () => {
    const { settleBetWithResult } = await import("@/lib/escrow-settle");
    const r = await settleBetWithResult({
      bet: makeBet({ contractHash: "hash-que-no-coincide" }),
      winnerNpubs: [np1],
      resultEvent: fakeEvent,
    });
    expect(r).toMatchObject({ ok: false, code: "CONTRACT_MISMATCH", status: 409 });
    expect(payCalls).toHaveLength(0);
  });

  it("paga si el hash del contrato coincide", async () => {
    const { settleBetWithResult } = await import("@/lib/escrow-settle");
    const hash = computeContractHash({
      betId: "bet1",
      gameId: "g1",
      stakeMsat: 10_000n,
      feePct: 5,
      victoryCondition: "mayor puntaje",
      npubs: [np1, np2],
    });
    const r = await settleBetWithResult({
      bet: makeBet({ contractHash: hash }),
      winnerNpubs: [np1],
      resultEvent: fakeEvent,
    });
    expect(r.ok).toBe(true);
    expect(payCalls).toEqual([{ npub: np1, amountMsat: 19_000n, kind: "payout" }]);
  });
});
