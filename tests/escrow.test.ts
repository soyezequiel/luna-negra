import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { validateCreateBet, computeContractHash } from "@/lib/escrow";

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

  describe("apuesta anónima (sin npubs)", () => {
    const anonCfg = { ...cfg, maxSeats: 8 };

    it("válida → marca anonymous y seatCount, sin npubs/pubkeys", () => {
      const r = validateCreateBet(
        { gameId: "g1", anonymous: true, seats: 2, stakeSats: 10 },
        anonCfg,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.anonymous).toBe(true);
        expect(r.seatCount).toBe(2);
        expect(r.npubs).toEqual([]);
        expect(r.pubkeys).toEqual([]);
        expect(r.stakeMsat).toBe(10000n);
      }
    });

    it("asientos fuera de rango (menos de 2 o más que el tope)", () => {
      expect(validateCreateBet({ gameId: "g", anonymous: true, seats: 1, stakeSats: 10 }, anonCfg)).toMatchObject({ code: "INVALID_SEATS" });
      expect(validateCreateBet({ gameId: "g", anonymous: true, seats: 9, stakeSats: 10 }, anonCfg)).toMatchObject({ code: "INVALID_SEATS" });
      expect(validateCreateBet({ gameId: "g", anonymous: true, seats: 2.5, stakeSats: 10 }, anonCfg)).toMatchObject({ code: "INVALID_SEATS" });
    });

    it("la apuesta normal sigue marcando anonymous=false", () => {
      const r = validateCreateBet({ gameId: "g1", participants: [np1, np2], stakeSats: 10 }, cfg);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.anonymous).toBe(false);
        expect(r.seatCount).toBe(2);
      }
    });
  });

  describe("apuesta mixta (npubs + invitados)", () => {
    const mixCfg = { ...cfg, maxSeats: 8 };

    it("acepta npub real + placeholder de invitado, en orden", () => {
      const r = validateCreateBet(
        { gameId: "g1", participants: [np1, { guest: true }], stakeSats: 10 },
        mixCfg,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.anonymous).toBe(false);
        expect(r.hasGuests).toBe(true);
        expect(r.seatCount).toBe(2);
        // npubs/pubkeys solo contienen los reales; el invitado se mintea en el route.
        expect(r.npubs).toEqual([np1]);
        expect(r.seatSpecs.map((s) => s.kind)).toEqual(["npub", "guest"]);
      }
    });

    it("apuesta 100% con cuenta no tiene invitados", () => {
      const r = validateCreateBet({ gameId: "g1", participants: [np1, np2], stakeSats: 10 }, mixCfg);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.hasGuests).toBe(false);
        expect(r.seatSpecs.map((s) => s.kind)).toEqual(["npub", "npub"]);
      }
    });

    it("dos invitados explícitos por participants equivalen a anónima", () => {
      const r = validateCreateBet(
        { gameId: "g1", participants: [{ guest: true }, { guest: true }], stakeSats: 10 },
        mixCfg,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.hasGuests).toBe(true);
        expect(r.seatCount).toBe(2);
        expect(r.npubs).toEqual([]);
      }
    });
  });
});

describe("computeContractHash", () => {
  const base = {
    betId: "bet1",
    gameId: "g1",
    stakeMsat: 10000n,
    feePct: 5,
    victoryCondition: "mayor puntaje",
    npubs: [np1, np2],
  };

  it("es determinista y no depende del orden de participantes", () => {
    const a = computeContractHash(base);
    const b = computeContractHash({ ...base, npubs: [np2, np1] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambia si se altera el stake", () => {
    expect(computeContractHash({ ...base, stakeMsat: 20000n })).not.toBe(
      computeContractHash(base),
    );
  });

  it("cambia si se altera el fee", () => {
    expect(computeContractHash({ ...base, feePct: 10 })).not.toBe(
      computeContractHash(base),
    );
  });

  it("cambia si cambian los participantes", () => {
    expect(computeContractHash({ ...base, npubs: [np1] })).not.toBe(
      computeContractHash(base),
    );
  });
});
