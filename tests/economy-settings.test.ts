import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: null as {
    storeFeePct: number;
    betFeePct: number;
    betDevFeeMaxPct: number;
    updatedAt: Date;
  } | null,
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformSettings: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

beforeEach(() => {
  mocks.row = null;
  mocks.findUnique.mockReset().mockImplementation(async () => mocks.row);
  mocks.upsert.mockReset().mockImplementation(async ({ create, update }) => {
    const updatedAt = new Date("2026-06-23T12:00:00.000Z");
    mocks.row = {
      storeFeePct: update.storeFeePct ?? create.storeFeePct,
      betFeePct: update.betFeePct ?? create.betFeePct,
      betDevFeeMaxPct: update.betDevFeeMaxPct ?? create.betDevFeeMaxPct,
      updatedAt,
    };
    return mocks.row;
  });
});

describe("economy settings", () => {
  it("usa defaults cuando todavia no hay fila persistida", async () => {
    const { getEconomySettings } = await import("@/lib/economy-settings");

    await expect(getEconomySettings()).resolves.toMatchObject({
      storeFeePct: 30,
      providerRevenueShare: 70,
      betFeePct: 5,
      betDevFeeMaxPct: 20,
      configured: false,
    });
  });

  it("guarda comision de tienda y apuesta normalizadas", async () => {
    const { updateEconomySettings } = await import("@/lib/economy-settings");

    const settings = await updateEconomySettings({
      storeFeePct: 25.9,
      betFeePct: "8",
      betDevFeeMaxPct: "15",
    });

    expect(settings).toMatchObject({
      storeFeePct: 25,
      providerRevenueShare: 75,
      betFeePct: 8,
      betDevFeeMaxPct: 15,
      configured: true,
    });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: "global" },
      create: { id: "global", storeFeePct: 25, betFeePct: 8, betDevFeeMaxPct: 15 },
      update: { storeFeePct: 25, betFeePct: 8, betDevFeeMaxPct: 15 },
    });
  });

  it("rechaza porcentajes fuera de rango", async () => {
    const { updateEconomySettings } = await import("@/lib/economy-settings");

    await expect(updateEconomySettings({ storeFeePct: 101 })).rejects.toThrow(
      "entre 0 y 100",
    );
  });

  it("rechaza porcentajes vacios", async () => {
    const { updateEconomySettings } = await import("@/lib/economy-settings");

    await expect(updateEconomySettings({ betFeePct: "" })).rejects.toThrow(
      "porcentaje valido",
    );
  });
});

describe("resolveBetFees (cortes casa + dev de una apuesta)", () => {
  const economy = {
    storeFeePct: 30,
    providerRevenueShare: 70,
    betFeePct: 5,
    betDevFeeMaxPct: 20,
    updatedAt: null,
    configured: true,
  };

  it("sin overrides: casa = global, dev = default del proveedor", async () => {
    const { resolveBetFees } = await import("@/lib/economy-settings");
    expect(
      resolveBetFees({
        game: { betFeePct: null, betDevFeePct: null },
        provider: { betDevFeePct: 3 },
        economy,
      }),
    ).toEqual({ feePct: 5, devFeePct: 3 });
  });

  it("override por juego de ambos cortes pisa el global/default", async () => {
    const { resolveBetFees } = await import("@/lib/economy-settings");
    expect(
      resolveBetFees({
        game: { betFeePct: 8, betDevFeePct: 10 },
        provider: { betDevFeePct: 3 },
        economy,
      }),
    ).toEqual({ feePct: 8, devFeePct: 10 });
  });

  it("el corte del dev se acota al tope global", async () => {
    const { resolveBetFees } = await import("@/lib/economy-settings");
    // El juego pide 50% pero el tope es 20%.
    expect(
      resolveBetFees({
        game: { betFeePct: null, betDevFeePct: 50 },
        provider: { betDevFeePct: 3 },
        economy,
      }),
    ).toEqual({ feePct: 5, devFeePct: 20 });
    // También acota el default del proveedor.
    expect(
      resolveBetFees({
        game: { betFeePct: null, betDevFeePct: null },
        provider: { betDevFeePct: 99 },
        economy,
      }),
    ).toEqual({ feePct: 5, devFeePct: 20 });
  });
});
