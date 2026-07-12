import { describe, expect, it } from "vitest";
import {
  reconcileLivePresence,
  type LiveState,
  type PresenceObservation,
} from "@/lib/live-presence";

// La reconciliación persistente es la que arregla el parpadeo "va y vuelve": una
// query flaky que pierde un evento NO debe tirar el conteo a 0; un jugador solo
// sale cuando vence su presencia (expiración NIP-40) o llega un clear. Estos tests
// fijan ese contrato.

const NOW = 1_000_000;

function emptyState(): LiveState {
  return { byGame: new Map(), tombstones: new Map(), seenAt: new Map() };
}

function obs(p: Partial<PresenceObservation> & { pubkey: string }): PresenceObservation {
  return {
    npub: `npub-${p.pubkey}`,
    gameId: "gameA",
    providerId: "prov1",
    active: true,
    createdAt: NOW - 10,
    expiresAt: NOW + 200,
    ...p,
  };
}

function npubsOf(st: LiveState, gameId: string): string[] {
  return [...(st.byGame.get(gameId)?.values() ?? [])].map((e) => e.npub);
}

describe("reconcileLivePresence", () => {
  it("cuenta a un jugador activo anclado a un juego", () => {
    const st = emptyState();
    reconcileLivePresence(st, [obs({ pubkey: "A" })], NOW);
    expect(npubsOf(st, "gameA")).toEqual(["npub-A"]);
  });

  it("PERSISTE al jugador cuando un ciclo no lo trae (query flaky) — no parpadea a 0", () => {
    const st = emptyState();
    reconcileLivePresence(st, [obs({ pubkey: "A", expiresAt: NOW + 200 })], NOW);
    // Ciclo siguiente: la query no devolvió nada (relay lento). Sigue presente.
    reconcileLivePresence(st, [], NOW + 30);
    expect(npubsOf(st, "gameA")).toEqual(["npub-A"]);
  });

  it("baja al jugador cuando su presencia vence (expiración pasada)", () => {
    const st = emptyState();
    reconcileLivePresence(st, [obs({ pubkey: "A", expiresAt: NOW + 60 })], NOW);
    reconcileLivePresence(st, [], NOW + 61); // ya venció
    expect(npubsOf(st, "gameA")).toEqual([]);
    expect(st.byGame.has("gameA")).toBe(false);
  });

  it("un clear (evento no-activo más nuevo) lo baja al instante y recuerda el tombstone", () => {
    const st = emptyState();
    reconcileLivePresence(st, [obs({ pubkey: "A", createdAt: NOW - 10 })], NOW);
    reconcileLivePresence(
      st,
      [obs({ pubkey: "A", active: false, gameId: null, providerId: null, createdAt: NOW })],
      NOW,
    );
    expect(npubsOf(st, "gameA")).toEqual([]);
    expect(st.tombstones.get("A")).toBe(NOW);
  });

  it("anti-resurrección: tras el clear, un evento VIEJO pre-cierre no lo revive", () => {
    const st = emptyState();
    // clear a los NOW; luego un relay lento sirve el evento activo viejo (created NOW-10).
    reconcileLivePresence(
      st,
      [obs({ pubkey: "A", active: false, gameId: null, providerId: null, createdAt: NOW })],
      NOW,
    );
    reconcileLivePresence(st, [obs({ pubkey: "A", createdAt: NOW - 10, expiresAt: NOW + 200 })], NOW + 5);
    expect(npubsOf(st, "gameA")).toEqual([]);
  });

  it("un evento MÁS NUEVO tras el clear sí lo vuelve a contar (reabrió)", () => {
    const st = emptyState();
    reconcileLivePresence(
      st,
      [obs({ pubkey: "A", active: false, gameId: null, providerId: null, createdAt: NOW })],
      NOW,
    );
    reconcileLivePresence(st, [obs({ pubkey: "A", createdAt: NOW + 10, expiresAt: NOW + 210 })], NOW + 11);
    expect(npubsOf(st, "gameA")).toEqual(["npub-A"]);
    expect(st.tombstones.has("A")).toBe(false);
  });

  it("mueve al jugador de un juego a otro (slot d:general único)", () => {
    const st = emptyState();
    reconcileLivePresence(st, [obs({ pubkey: "A", gameId: "gameA", createdAt: NOW - 10 })], NOW);
    reconcileLivePresence(
      st,
      [obs({ pubkey: "A", gameId: "gameB", createdAt: NOW, expiresAt: NOW + 200 })],
      NOW + 1,
    );
    expect(npubsOf(st, "gameA")).toEqual([]);
    expect(npubsOf(st, "gameB")).toEqual(["npub-A"]);
  });

  it("staleness: un evento más viejo no pisa el vigente", () => {
    const st = emptyState();
    reconcileLivePresence(st, [obs({ pubkey: "A", createdAt: NOW, expiresAt: NOW + 200 })], NOW);
    // Relay sirve un evento más viejo del mismo jugador: se ignora.
    reconcileLivePresence(st, [obs({ pubkey: "A", createdAt: NOW - 50, expiresAt: NOW + 100 })], NOW + 1);
    expect(st.byGame.get("gameA")?.get("A")?.createdAt).toBe(NOW);
  });

  it("dos jugadores concurrentes se cuentan por separado", () => {
    const st = emptyState();
    reconcileLivePresence(
      st,
      [obs({ pubkey: "A" }), obs({ pubkey: "B" })],
      NOW,
    );
    expect(npubsOf(st, "gameA").sort()).toEqual(["npub-A", "npub-B"]);
  });
});
