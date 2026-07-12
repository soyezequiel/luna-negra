import { describe, expect, it } from "vitest";
import {
  presenceWasRefreshed,
  reconcileLivePresence,
  type LiveState,
  type PresenceObservation,
} from "@/lib/live-presence";

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

// El pico del día (PlayerCountSample) solo debe contar presencias CONFIRMADAS: una
// apertura de un solo disparo, que nunca renueva su estado NIP-38, no puede fijar el
// pico de 24h ni dejar la huella de "conteo colgado". `reconcileLivePresence` marca
// `confirmed` recién cuando el mismo jugador re-firma (created_at avanza entre ciclos).
describe("reconcileLivePresence: confirmación por renovación", () => {
  const GAME = "game1";
  const PROVIDER = "prov1";

  function freshState(): LiveState {
    return { byGame: new Map(), tombstones: new Map(), seenAt: new Map() };
  }

  function obs(pubkey: string, createdAt: number, nowSec: number): PresenceObservation {
    return {
      pubkey,
      npub: `npub_${pubkey}`,
      gameId: GAME,
      providerId: PROVIDER,
      active: true,
      createdAt,
      expiresAt: nowSec + 180, // dentro de la ventana de vigencia
    };
  }

  function entry(st: LiveState, pubkey: string) {
    return st.byGame.get(GAME)?.get(pubkey);
  }

  it("una primera vista queda SIN confirmar (no cuenta al pico)", () => {
    const st = freshState();
    const now = 10_000;
    reconcileLivePresence(st, [obs("pkA", now - 5, now)], now);
    expect(entry(st, "pkA")).toBeDefined();
    expect(entry(st, "pkA")?.confirmed).toBe(false);
  });

  it("se confirma cuando el mismo jugador renueva (created_at avanza)", () => {
    const st = freshState();
    const now1 = 10_000;
    reconcileLivePresence(st, [obs("pkA", now1 - 5, now1)], now1);
    const now2 = now1 + 40;
    reconcileLivePresence(st, [obs("pkA", now2 - 2, now2)], now2); // re-firma
    expect(entry(st, "pkA")?.confirmed).toBe(true);
  });

  it("una re-entrega del MISMO evento (created_at igual) no confirma", () => {
    const st = freshState();
    const now1 = 10_000;
    const createdAt = now1 - 5;
    reconcileLivePresence(st, [obs("pkA", createdAt, now1)], now1);
    const now2 = now1 + 30;
    reconcileLivePresence(st, [obs("pkA", createdAt, now2)], now2); // mismo created_at
    expect(entry(st, "pkA")?.confirmed).toBe(false);
  });

  it("una vez confirmada, se mantiene confirmada en ciclos siguientes", () => {
    const st = freshState();
    const now1 = 10_000;
    reconcileLivePresence(st, [obs("pkA", now1 - 5, now1)], now1);
    const now2 = now1 + 40;
    reconcileLivePresence(st, [obs("pkA", now2 - 2, now2)], now2); // confirma
    const now3 = now2 + 40;
    reconcileLivePresence(st, [obs("pkA", now3 - 2, now3)], now3);
    expect(entry(st, "pkA")?.confirmed).toBe(true);
  });
});
