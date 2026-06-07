import { describe, it, expect, beforeAll } from "vitest";
import { verifyEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { buildResultEventTemplate } from "@/lib/escrow";

const np1 = nip19.npubEncode("1".repeat(64));
const np2 = nip19.npubEncode("2".repeat(64));

beforeAll(() => {
  process.env.ORACLE_ENC_KEY = "0".repeat(64);
});

describe("buildResultEventTemplate", () => {
  it("kind 30078 con tags t/bet/winner", () => {
    const ev = buildResultEventTemplate({ betId: "bet1", winnerNpubs: [np1, np2] });
    expect(ev.kind).toBe(30078);
    expect(ev.tags).toContainEqual(["t", "lunanegra:result"]);
    expect(ev.tags).toContainEqual(["bet", "bet1"]);
    expect(ev.tags).toContainEqual(["winner", np1]);
    expect(ev.tags).toContainEqual(["winner", np2]);
  });

  it("sin ganadores (anulación) → sin tags winner", () => {
    const ev = buildResultEventTemplate({ betId: "bet1", winnerNpubs: [] });
    expect(ev.tags.filter((t) => t[0] === "winner")).toHaveLength(0);
  });
});

describe("signResultEvent (oráculo gestionado)", () => {
  it("produce un evento verificable firmado por la pubkey del oráculo", async () => {
    const { generateOracleKey } = await import("@/lib/oracle-keys");
    const { decryptSecret } = await import("@/lib/crypto-vault");
    const { signResultEvent } = await import("@/lib/nostr-server");

    const { pubkey, secretEnc } = generateOracleKey();
    const sk = decryptSecret(secretEnc);
    const ev = signResultEvent(sk, "bet42", [np1]);

    expect(verifyEvent(ev)).toBe(true);
    expect(ev.pubkey).toBe(pubkey);
    expect(ev.tags).toContainEqual(["bet", "bet42"]);
    expect(ev.tags).toContainEqual(["winner", np1]);
  });
});
