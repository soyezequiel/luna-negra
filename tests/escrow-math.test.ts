import { describe, it, expect } from "vitest";
import {
  computeEconomics,
  splitWinnings,
  publicBetStatus,
} from "@/lib/escrow-math";

describe("computeEconomics", () => {
  it("pozo = stake × participantes; fee y neto correctos", () => {
    // 10 sats × 2 jugadores = 20_000 msat, fee 5% = 1_000, neto 19_000.
    const e = computeEconomics({ stakeMsat: 10_000n, participantCount: 2, feePct: 5 });
    expect(e.potMsat).toBe(20_000n);
    expect(e.feeMsat).toBe(1_000n);
    expect(e.netMsat).toBe(19_000n);
    expect(e.feeBps).toBe(500);
  });

  it("financiación total: el pozo escala con los participantes", () => {
    const e = computeEconomics({ stakeMsat: 5_000n, participantCount: 4, feePct: 5 });
    expect(e.potMsat).toBe(20_000n);
    expect(e.netMsat).toBe(19_000n);
  });

  it("fee 0% → neto = pozo", () => {
    const e = computeEconomics({ stakeMsat: 10_000n, participantCount: 3, feePct: 0 });
    expect(e.feeMsat).toBe(0n);
    expect(e.netMsat).toBe(30_000n);
  });
});

describe("splitWinnings (reparto entre ganadores)", () => {
  it("un solo ganador se lleva todo el neto", () => {
    expect(splitWinnings(19_000n, 1)).toEqual({ perWinner: 19_000n, dust: 0n });
  });

  it("dos ganadores: división pareja", () => {
    expect(splitWinnings(19_000n, 2)).toEqual({ perWinner: 9_500n, dust: 0n });
  });

  it("reparto indivisible: el resto (dust) queda para la casa", () => {
    // 19_001 / 2 = 9_500 c/u, sobra 1 msat.
    expect(splitWinnings(19_001n, 2)).toEqual({ perWinner: 9_500n, dust: 1n });
  });

  it("tres ganadores con resto", () => {
    const { perWinner, dust } = splitWinnings(20_000n, 3);
    expect(perWinner).toBe(6_666n);
    expect(dust).toBe(2n);
    expect(perWinner * 3n + dust).toBe(20_000n);
  });
});

describe("draw/void: reembolso total = stake a cada uno", () => {
  it("sin fee, cada jugador recupera su stake exacto", () => {
    // En void no se calcula fee: se reembolsa stakeMsat a cada participante.
    const stakeMsat = 10_000n;
    const participants = 3;
    const totalRefund = stakeMsat * BigInt(participants);
    const pot = computeEconomics({ stakeMsat, participantCount: participants, feePct: 5 }).potMsat;
    expect(totalRefund).toBe(pot); // se devuelve todo el pozo, sin comisión
  });
});

describe("publicBetStatus (mapeo interno → público)", () => {
  it("mapea cada estado interno", () => {
    expect(publicBetStatus("created")).toBe("pending_deposits");
    expect(publicBetStatus("pending_deposits")).toBe("pending_deposits");
    expect(publicBetStatus("ready")).toBe("funded");
    expect(publicBetStatus("settling")).toBe("funded");
    expect(publicBetStatus("settled")).toBe("settled");
    expect(publicBetStatus("cancelled_admin")).toBe("cancelled");
    expect(publicBetStatus("cancelled_incomplete")).toBe("expired");
    expect(publicBetStatus("refunded_timeout")).toBe("refunded");
    expect(publicBetStatus("voided")).toBe("refunded");
  });
});
