import { describe, it, expect } from "vitest";
import { canTransition, isTerminal } from "@/lib/bet-state";

describe("bet-state", () => {
  it("transición válida", () => {
    expect(canTransition("ready", "settling")).toBe(true);
    expect(canTransition("pending_deposits", "ready")).toBe(true);
  });
  it("transición inválida", () => {
    expect(canTransition("created", "settled")).toBe(false);
    expect(canTransition("settled", "ready")).toBe(false);
  });
  it("estados terminales no tienen salida", () => {
    expect(isTerminal("settled")).toBe(true);
    expect(isTerminal("cancelled_admin")).toBe(true);
    expect(isTerminal("refunded_timeout")).toBe(true);
  });
  it("estados no terminales", () => {
    expect(isTerminal("ready")).toBe(false);
    expect(isTerminal("pending_deposits")).toBe(false);
  });
  it("estado desconocido no transiciona", () => {
    expect(canTransition("xxx", "settled")).toBe(false);
  });
});
