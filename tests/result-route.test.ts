import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks de las dependencias del route (lógica de auth/autorización aislada).
let apiKeyProvider: string | null = "prov1";
vi.mock("@/lib/api-keys", () => ({
  verifyApiKey: vi.fn(async () => apiKeyProvider),
}));

let oracleSecret: Uint8Array | null = new Uint8Array([1, 2, 3]);
const ensureOracleCalls: string[] = [];
vi.mock("@/lib/oracle-keys", () => ({
  getOracleSecret: vi.fn(async () => oracleSecret),
  ensureOracleKey: vi.fn(async (providerId: string) => {
    ensureOracleCalls.push(providerId);
    oracleSecret = new Uint8Array([4, 5, 6]);
    return "oracle-pub";
  }),
}));

vi.mock("@/lib/nostr-server", () => ({
  signResultEvent: vi.fn(() => ({ id: "evt-signed", pubkey: "oracle-pub" })),
}));

const settleArgs: unknown[] = [];
let settleReturn: unknown = { ok: true };
vi.mock("@/lib/escrow-settle", () => ({
  settleBetWithResult: vi.fn(async (args: unknown) => {
    settleArgs.push(args);
    return settleReturn;
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ success: true, limit: 30, remaining: 29, reset: 60 })),
  rateLimitHeaders: vi.fn(() => ({})),
}));

let betRow: unknown = {
  id: "bet1",
  providerId: "prov1",
  provider: { oraclePubkey: "oracle-pub", owner: { pubkey: "owner-pub" } },
  participants: [],
};
vi.mock("@/lib/prisma", () => ({
  prisma: { bet: { findUnique: vi.fn(async () => betRow) } },
}));

async function callApiKey(body: unknown) {
  const { POST } = await import("@/app/api/v1/bets/[id]/result/route");
  const req = new Request("http://x/api/v1/bets/bet1/result", {
    method: "POST",
    headers: { authorization: "Bearer ln_sk_test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ id: "bet1" }) });
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  apiKeyProvider = "prov1";
  oracleSecret = new Uint8Array([1, 2, 3]);
  ensureOracleCalls.length = 0;
  settleReturn = { ok: true };
  settleArgs.length = 0;
  betRow = {
    id: "bet1",
    providerId: "prov1",
    provider: { oraclePubkey: "oracle-pub", owner: { pubkey: "owner-pub" } },
    participants: [],
  };
});

describe("POST /result — camino API key", () => {
  it("happy path: firma con el oráculo y delega en settle", async () => {
    const { status, json } = await callApiKey({ winners: ["npub1abc"] });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(settleArgs).toHaveLength(1);
    expect((settleArgs[0] as { winnerNpubs: string[] }).winnerNpubs).toEqual(["npub1abc"]);
  });

  it("winners vacío → anulación (delegada a settle)", async () => {
    settleReturn = { ok: true, voided: true };
    const { status, json } = await callApiKey({ winners: [] });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, voided: true });
  });

  it("API key de otro proveedor → 403 FORBIDDEN", async () => {
    apiKeyProvider = "otro-proveedor";
    const { status, json } = await callApiKey({ winners: ["npub1abc"] });
    expect(status).toBe(403);
    expect(json.error.code).toBe("FORBIDDEN");
    expect(settleArgs).toHaveLength(0);
  });

  it("winners no-array → 400 BAD_WINNERS", async () => {
    const { status, json } = await callApiKey({ winners: "npub1abc" });
    expect(status).toBe(400);
    expect(json.error.code).toBe("BAD_WINNERS");
  });

  it("provisiona el oráculo si falta y reporta el ganador", async () => {
    oracleSecret = null;
    const { status, json } = await callApiKey({ winners: ["npub1abc"] });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(ensureOracleCalls).toEqual(["prov1"]);
    expect(settleArgs).toHaveLength(1);
  });

  it("API key inválida → 401", async () => {
    apiKeyProvider = null;
    const { status, json } = await callApiKey({ winners: ["npub1abc"] });
    expect(status).toBe(401);
    expect(json.error.code).toBe("INVALID_API_KEY");
  });

  it("doble reporte: settle ya terminal → 200 idempotente (alreadyResolved)", async () => {
    settleReturn = { ok: true, alreadyResolved: true, finalStatus: "settled" };
    const { status, json } = await callApiKey({ winners: ["npub1abc"] });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, alreadyResolved: true, status: "settled" });
  });
});
