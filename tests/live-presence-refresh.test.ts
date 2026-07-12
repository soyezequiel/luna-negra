import { describe, expect, it } from "vitest";
import { presenceWasRefreshed } from "@/lib/live-presence";

// La detección de integración de presencia (ping "ngp:presencia") solo debe
// dispararse con presencia SOSTENIDA — un jugador que renueva su estado NIP-38
// entre ciclos del sync — no con un evento optimista de un solo click que flota
// sobre su TTL. `presenceWasRefreshed` es la regla que separa un caso del otro.
describe("presenceWasRefreshed", () => {
  it("false en la primera vista (sin ciclo previo): no alcanza para integrar", () => {
    const current = new Map([["pkA", 1000]]);
    expect(presenceWasRefreshed(undefined, current)).toBe(false);
  });

  it("false si el mismo evento sigue vivo sin renovarse (click optimista sobre su TTL)", () => {
    const prev = new Map([["pkA", 1000]]);
    const current = new Map([["pkA", 1000]]); // mismo created_at → no se renovó
    expect(presenceWasRefreshed(prev, current)).toBe(false);
  });

  it("true si el mismo jugador renovó su estado (created_at más nuevo)", () => {
    const prev = new Map([["pkA", 1000]]);
    const current = new Map([["pkA", 1008]]); // refresco ~8s después
    expect(presenceWasRefreshed(prev, current)).toBe(true);
  });

  it("false si aparece OTRO jugador nuevo (no es renovación del que ya estaba)", () => {
    const prev = new Map([["pkA", 1000]]);
    const current = new Map([["pkB", 2000]]); // pubkey distinta, primera vista
    expect(presenceWasRefreshed(prev, current)).toBe(false);
  });

  it("true si al menos un jugador de varios renovó", () => {
    const prev = new Map([
      ["pkA", 1000],
      ["pkB", 1000],
    ]);
    const current = new Map([
      ["pkA", 1000], // no renovó
      ["pkB", 1030], // renovó
    ]);
    expect(presenceWasRefreshed(prev, current)).toBe(true);
  });

  it("false si un created_at retrocede (evento fuera de orden en relays, no cuenta)", () => {
    const prev = new Map([["pkA", 1000]]);
    const current = new Map([["pkA", 990]]);
    expect(presenceWasRefreshed(prev, current)).toBe(false);
  });
});
