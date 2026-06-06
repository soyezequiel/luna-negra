import { describe, it, expect, vi } from "vitest";

// next/headers solo existe dentro de Next → lo mockeamos para poder importar auth.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import {
  signSession,
  verifySession,
  signChallenge,
  verifyChallenge,
  signEntitlement,
  verifyEntitlement,
  signBetSession,
  verifyBetSession,
  signInvite,
  verifyInvite,
} from "@/lib/auth";

describe("sesión JWT", () => {
  it("firma y verifica (round-trip)", async () => {
    const token = await signSession({ sub: "u1", npub: "npub1x", pubkey: "ab" });
    const payload = await verifySession(token);
    expect(payload?.sub).toBe("u1");
    expect(payload?.npub).toBe("npub1x");
  });

  it("token inválido devuelve null", async () => {
    expect(await verifySession("no.es.un.jwt")).toBeNull();
  });
});

describe("challenge", () => {
  it("round-trip", async () => {
    const t = await signChallenge("abc", "nonce1");
    expect(await verifyChallenge(t)).toEqual({ pubkey: "abc", nonce: "nonce1" });
  });

  it("un token de sesión no se acepta como challenge", async () => {
    const t = await signSession({ sub: "u1", npub: "n", pubkey: "p" });
    expect(await verifyChallenge(t)).toBeNull();
  });
});

describe("entitlement", () => {
  it("round-trip", async () => {
    const t = await signEntitlement({
      npub: "n",
      pubkey: "p",
      gameId: "g1",
      slug: "s1",
    });
    const e = await verifyEntitlement(t);
    expect(e?.gameId).toBe("g1");
    expect(e?.slug).toBe("s1");
  });

  it("un challenge no se acepta como entitlement", async () => {
    const t = await signChallenge("abc", "n");
    expect(await verifyEntitlement(t)).toBeNull();
  });
});

describe("bet-session", () => {
  it("round-trip", async () => {
    const t = await signBetSession({ sub: "u1", npub: "n", pubkey: "p" });
    const s = await verifyBetSession(t);
    expect(s?.sub).toBe("u1");
  });

  it("un entitlement no se acepta como bet-session", async () => {
    const t = await signEntitlement({ npub: "n", pubkey: "p", gameId: "g", slug: "s" });
    expect(await verifyBetSession(t)).toBeNull();
  });
});

describe("invite (multijugador)", () => {
  it("round-trip con roomId y host", async () => {
    const t = await signInvite({
      npub: "n",
      pubkey: "p",
      gameId: "g1",
      slug: "s1",
      roomId: "abc123",
      host: true,
      hostNpub: "n",
      hostPubkey: "p",
    });
    const i = await verifyInvite(t);
    expect(i?.roomId).toBe("abc123");
    expect(i?.host).toBe(true);
    expect(i?.gameId).toBe("g1");
    expect(i?.hostNpub).toBe("n");
    expect(i?.hostPubkey).toBe("p");
    expect(typeof i?.expiresAt).toBe("string");
  });

  it("un entitlement no se acepta como invite", async () => {
    const t = await signEntitlement({ npub: "n", pubkey: "p", gameId: "g", slug: "s" });
    expect(await verifyInvite(t)).toBeNull();
  });
});
