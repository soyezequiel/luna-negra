import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { validateCreateBet } from "@/lib/escrow";

const pk1 = "1111111111111111111111111111111111111111111111111111111111111111";
const pk2 = "2222222222222222222222222222222222222222222222222222222222222222";
const np1 = nip19.npubEncode(pk1);
const np2 = nip19.npubEncode(pk2);
const cfg = { minSats: 5, maxSats: 100 };

describe("validateCreateBet", () => {
  it("válido → convierte a msat y decodifica npubs", () => {
    const r = validateCreateBet(
      { gameId: "g1", participants: [np1, np2], stakeSats: 10, victoryCondition: "mayor puntaje" },
      cfg,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.stakeMsat).toBe(10000n);
      expect(r.pubkeys).toEqual([pk1, pk2]);
    }
  });

  it("stake fuera de rango", () => {
    expect(validateCreateBet({ gameId: "g", participants: [np1, np2], stakeSats: 1 }, cfg)).toMatchObject({ code: "STAKE_OUT_OF_RANGE" });
    expect(validateCreateBet({ gameId: "g", participants: [np1, np2], stakeSats: 101 }, cfg)).toMatchObject({ code: "STAKE_OUT_OF_RANGE" });
  });

  it("menos de 2 participantes", () => {
    expect(validateCreateBet({ gameId: "g", participants: [np1], stakeSats: 10 }, cfg)).toMatchObject({ code: "INVALID_PARTICIPANTS" });
  });

  it("npub inválido", () => {
    expect(validateCreateBet({ gameId: "g", participants: [np1, "noesnpub"], stakeSats: 10 }, cfg)).toMatchObject({ code: "INVALID_NPUB" });
  });

  it("participantes duplicados", () => {
    expect(validateCreateBet({ gameId: "g", participants: [np1, np1], stakeSats: 10 }, cfg)).toMatchObject({ code: "DUPLICATE_PARTICIPANT" });
  });

  it("falta gameId", () => {
    expect(validateCreateBet({ participants: [np1, np2], stakeSats: 10 }, cfg)).toMatchObject({ code: "MISSING_GAME" });
  });
});
