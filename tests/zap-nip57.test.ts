import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContractTagsV2 } from "@/lib/escrow-v2";
import {
  siteUrl,
  storeLightningAddress,
  storeLnurlUrl,
} from "@/lib/site-url";
import { buildUnsignedZapRequest } from "@/lib/zap";

const makeInvoice = vi.fn(async () => ({
  invoice: "lnbc-test",
  payment_hash: "payment-hash",
  expires_at: 123456,
}));

vi.mock("@getalby/sdk", () => ({
  NWCClient: class {
    makeInvoice = makeInvoice;
  },
  Nip47TimeoutError: class extends Error {},
  Nip47NetworkError: class extends Error {},
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  makeInvoice.mockClear();
});

describe("NIP-57 de apuestas", () => {
  it("genera la direccion y endpoint LNURL estables de Luna Negra", () => {
    const base = "https://luna.naranja.fit";
    expect(storeLightningAddress(base)).toBe("luna@luna.naranja.fit");
    expect(storeLnurlUrl(base)).toBe(
      "https://luna.naranja.fit/.well-known/lnurlp/luna",
    );
    expect(siteUrl(new Request(`${base}/api/test`))).toBe(base);
  });

  it("marca el contrato con el receptor zap explicito y sin p-tags de jugadores", () => {
    const tags = buildContractTagsV2({
      betId: "bet-1",
      contractHash: "hash",
      zapReceiver: {
        pubkey: "store",
        relay: "wss://relay.primal.net",
      },
    });

    expect(tags).toContainEqual([
      "zap",
      "store",
      "wss://relay.primal.net",
    ]);
    // Editorial: el ancla no menciona (p-tag) a los jugadores — eso notificaba
    // a cada uno en todos sus clientes por cada apuesta. Asientos → 31340.
    expect(tags.some((t) => t[0] === "p")).toBe(false);
  });

  it("incluye e y k en el zap request del post", () => {
    const request = buildUnsignedZapRequest({
      amountSats: 10,
      recipientPubkey: "a".repeat(64),
      eventId: "b".repeat(64),
      eventKind: 1,
      lnurl: "lnurl1test",
      relays: ["wss://relay.primal.net"],
    });

    expect(request.tags).toContainEqual(["e", "b".repeat(64)]);
    expect(request.tags).toContainEqual(["k", "1"]);
  });

  it("pide al NWC un invoice con description_hash y sin memo plano", async () => {
    vi.stubEnv(
      "NWC_CONNECTION_STRING",
      "nostr+walletconnect://wallet?relay=wss%3A%2F%2Frelay.example&secret=test",
    );
    const { createDescriptionHashInvoice } = await import("@/lib/lightning");
    const hash = "ab".repeat(32);

    await createDescriptionHashInvoice(18, hash);

    expect(makeInvoice).toHaveBeenCalledWith({
      amount: 18_000,
      description_hash: hash,
      expiry: 900,
    });
  });
});
