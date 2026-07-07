import { describe, it, expect } from "vitest";
import { effectiveOracle, isValidResultSigner } from "@/lib/bet-oracle";

// Modelo unificado de oráculo: NGP (TOFU) usa el oráculo declarado en el contrato
// (bet.oraclePubkey); el REST legacy usa el gestionado del proveedor.
const TETRIS = "a".repeat(64);
const MANAGED = "b".repeat(64);
const ATTACKER = "c".repeat(64);

describe("effectiveOracle", () => {
  it("NGP con oráculo declarado en el contrato → ese (TOFU por-apuesta)", () => {
    expect(effectiveOracle({ oraclePubkey: TETRIS, provider: { oraclePubkey: MANAGED } })).toBe(TETRIS);
  });
  it("REST legacy sin contrato → oráculo gestionado del proveedor", () => {
    expect(effectiveOracle({ oraclePubkey: null, provider: { oraclePubkey: MANAGED } })).toBe(MANAGED);
  });
  it("sin ninguno → null", () => {
    expect(effectiveOracle({ oraclePubkey: null, provider: { oraclePubkey: null } })).toBeNull();
  });
});

describe("isValidResultSigner", () => {
  it("firma del oráculo del contrato NGP → válido", () => {
    const bet = { oraclePubkey: TETRIS, provider: { oraclePubkey: MANAGED } };
    expect(isValidResultSigner(bet, TETRIS)).toBe(true);
  });
  it("firma del oráculo gestionado en un bet NGP con otro oráculo → RECHAZA", () => {
    // Clave: en TOFU manda el oráculo del contrato, no el del proveedor.
    const bet = { oraclePubkey: TETRIS, provider: { oraclePubkey: MANAGED } };
    expect(isValidResultSigner(bet, MANAGED)).toBe(false);
  });
  it("firma de un tercero → RECHAZA", () => {
    const bet = { oraclePubkey: TETRIS, provider: { oraclePubkey: MANAGED } };
    expect(isValidResultSigner(bet, ATTACKER)).toBe(false);
  });
  it("REST legacy: firma del oráculo gestionado → válido", () => {
    const bet = { oraclePubkey: null, provider: { oraclePubkey: MANAGED } };
    expect(isValidResultSigner(bet, MANAGED)).toBe(true);
  });
  it("sin oráculo configurado → RECHAZA cualquier firma", () => {
    const bet = { oraclePubkey: null, provider: { oraclePubkey: null } };
    expect(isValidResultSigner(bet, TETRIS)).toBe(false);
  });
});
