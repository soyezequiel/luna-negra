import { describe, it, expect } from "vitest";
import { isChallengerVoid } from "@/lib/ngp-bet-result-sync";

// Autorización del "void del retador" (NGP Fase 3): el autor del contrato 1339
// puede cancelar su apuesta pre-fondeo con un 1341 status=void. La firma se valida
// aparte (verifyEvent); este predicado decide solo QUIÉN y EN QUÉ ESTADO.
const CHALLENGER = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("isChallengerVoid", () => {
  it("void del autor del contrato mientras espera depósitos → autoriza", () => {
    expect(
      isChallengerVoid({
        status: "void",
        betStatus: "pending_deposits",
        contractPubkey: CHALLENGER,
        signerPubkey: CHALLENGER,
      }),
    ).toBe(true);
  });

  it("una vez fondeada (ready) el retador NO puede anular → rechaza", () => {
    expect(
      isChallengerVoid({
        status: "void",
        betStatus: "ready",
        contractPubkey: CHALLENGER,
        signerPubkey: CHALLENGER,
      }),
    ).toBe(false);
  });

  it("firmante distinto del autor del contrato → rechaza", () => {
    expect(
      isChallengerVoid({
        status: "void",
        betStatus: "pending_deposits",
        contractPubkey: CHALLENGER,
        signerPubkey: OTHER,
      }),
    ).toBe(false);
  });

  it("status distinto de void (win/draw) → rechaza (no es una anulación)", () => {
    for (const status of ["win", "draw", "resolved", ""]) {
      expect(
        isChallengerVoid({
          status,
          betStatus: "pending_deposits",
          contractPubkey: CHALLENGER,
          signerPubkey: CHALLENGER,
        }),
      ).toBe(false);
    }
  });

  it("apuesta v2 REST sin contrato 1339 (contractPubkey null) → rechaza", () => {
    expect(
      isChallengerVoid({
        status: "void",
        betStatus: "pending_deposits",
        contractPubkey: null,
        signerPubkey: CHALLENGER,
      }),
    ).toBe(false);
  });
});
