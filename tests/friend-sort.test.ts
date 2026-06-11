import { describe, expect, it } from "vitest";
import { friendTier, compareFriends } from "@/lib/friend-sort";

describe("friendTier", () => {
  it("jugando ahora es el tier más alto", () => {
    expect(
      friendTier({ playingNow: true, lastPlayedAt: null, isMember: false }),
    ).toBe(0);
  });
  it("jugó alguna vez va antes que solo-miembro", () => {
    expect(
      friendTier({ playingNow: false, lastPlayedAt: 123, isMember: true }),
    ).toBe(1);
    expect(
      friendTier({ playingNow: false, lastPlayedAt: null, isMember: true }),
    ).toBe(2);
  });
  it("el resto es el tier más bajo", () => {
    expect(
      friendTier({ playingNow: false, lastPlayedAt: null, isMember: false }),
    ).toBe(3);
  });
});

describe("compareFriends", () => {
  const mk = (
    name: string,
    o: Partial<{ playingNow: boolean; lastPlayedAt: number | null; isMember: boolean }> = {},
  ) => ({
    name,
    playingNow: o.playingNow ?? false,
    lastPlayedAt: o.lastPlayedAt ?? null,
    isMember: o.isMember ?? false,
  });

  it("ordena por tiers: jugando > jugó > miembro > resto", () => {
    const list = [
      mk("resto"),
      mk("miembro", { isMember: true }),
      mk("jugando", { playingNow: true }),
      mk("jugo", { lastPlayedAt: 100, isMember: true }),
    ];
    const sorted = [...list].sort(compareFriends).map((f) => f.name);
    expect(sorted).toEqual(["jugando", "jugo", "miembro", "resto"]);
  });

  it("dentro de 'jugó alguna vez' gana el más reciente", () => {
    const list = [
      mk("viejo", { lastPlayedAt: 100, isMember: true }),
      mk("nuevo", { lastPlayedAt: 999, isMember: true }),
    ];
    expect([...list].sort(compareFriends).map((f) => f.name)).toEqual([
      "nuevo",
      "viejo",
    ]);
  });

  it("desempata alfabéticamente dentro del mismo tier", () => {
    const list = [mk("Zeta", { isMember: true }), mk("Alfa", { isMember: true })];
    expect([...list].sort(compareFriends).map((f) => f.name)).toEqual([
      "Alfa",
      "Zeta",
    ]);
  });
});
