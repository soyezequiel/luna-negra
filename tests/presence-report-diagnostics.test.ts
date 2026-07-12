import { describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import {
  buildDiagnostics,
  classify,
  toReportEvent,
  type ReportEvent,
} from "@/lib/presence-report";

// El motor de diagnóstico es el corazón del reporte de presencia: debe señalar las
// causas conocidas de que un juego cerrado se siga detectando como abierto. Estos
// tests fijan ese contrato con eventos sintéticos (sin tocar relays ni DB).

const COORD = "30023:aaaa:ajedrez";
const PK_A = "a".repeat(64);
const PK_B = "b".repeat(64);
const NOW = 1_700_000_000;
const WINDOW_START = NOW - 180;

function ev(partial: Partial<Event> & { pubkey: string; created_at: number }): Event {
  return {
    id: `id-${partial.pubkey.slice(0, 4)}-${partial.created_at}`,
    kind: 30315,
    content: "Jugando Ajedrez en Luna Negra",
    tags: [
      ["d", "general"],
      ["a", COORD],
    ],
    sig: "",
    ...partial,
  } as Event;
}

function toRE(e: Event, relays = ["wss://r1"]): ReportEvent {
  return toReportEvent(e, COORD, NOW, WINDOW_START, relays);
}

const relaysAllOk = (latest: number | null) => [
  { relay: "wss://r1", latestCreatedAt: latest, events: latest === null ? 0 : 1 },
];

describe("classify", () => {
  it("distingue tombstone, presencia de la tienda y del juego", () => {
    expect(classify(ev({ pubkey: PK_A, created_at: NOW, content: "" }), COORD)).toBe("tombstone");
    expect(
      classify(
        ev({ pubkey: PK_A, created_at: NOW, tags: [["d", "general"], ["l", "luna-negra"]] }),
        COORD,
      ),
    ).toBe("store-optimistic");
    expect(classify(ev({ pubkey: PK_A, created_at: NOW }), COORD)).toBe("game-signed");
  });
});

describe("buildDiagnostics", () => {
  function codes(diags: ReturnType<typeof buildDiagnostics>): string[] {
    return diags.map((d) => d.code);
  }

  it("marca EVENTS_WITHOUT_NIP40 cuando un evento del juego no trae expiración", () => {
    // Presencia auto-firmada por el juego, con contenido y SIN tag expiration:
    // el parser la considera "activa" para siempre → nunca vence sola.
    const e = toRE(ev({ pubkey: PK_A, created_at: NOW - 10 })); // sin tag expiration
    expect(e.hasExpiration).toBe(false);
    expect(e.parserActive).toBe(true); // el parser la da por activa (bug de fondo)

    const diags = buildDiagnostics({
      coordEvents: [e],
      slotLatest: new Map([[e.pubkey, e]]),
      liveResolution: [{ npub: e.npub, counted: true }],
      coordPerRelay: relaysAllOk(NOW - 10),
      nowSec: NOW,
    });
    const alert = diags.find((d) => d.code === "EVENTS_WITHOUT_NIP40");
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe("alert");
  });

  it("marca RELAY_DIVERGENCE cuando los relays discrepan en el evento más nuevo", () => {
    const e = toRE(ev({ pubkey: PK_A, created_at: NOW - 5, tags: [["d", "general"], ["a", COORD], ["expiration", String(NOW + 100)]] }));
    const diags = buildDiagnostics({
      coordEvents: [e],
      slotLatest: new Map([[e.pubkey, e]]),
      liveResolution: [{ npub: e.npub, counted: true }],
      // Un relay tiene un evento fresco (NOW-5), otro sirve uno viejo (NOW-120):
      // 115s de diferencia > umbral → parpadeo "va y vuelve".
      coordPerRelay: [
        { relay: "wss://r1", latestCreatedAt: NOW - 5, events: 1 },
        { relay: "wss://r2", latestCreatedAt: NOW - 120, events: 1 },
      ],
      nowSec: NOW,
    });
    expect(codes(diags)).toContain("RELAY_DIVERGENCE");
  });

  it("no marca alertas cuando la presencia está sana (expiración futura, sin divergencia)", () => {
    const fresh = toRE(
      ev({
        pubkey: PK_B,
        created_at: NOW - 5,
        tags: [["d", "general"], ["a", COORD], ["expiration", String(NOW + 100)]],
      }),
    );
    const diags = buildDiagnostics({
      coordEvents: [fresh],
      slotLatest: new Map([[fresh.pubkey, fresh]]),
      liveResolution: [{ npub: fresh.npub, counted: true }],
      coordPerRelay: relaysAllOk(NOW - 5),
      nowSec: NOW,
    });
    // MISSING_TOMBSTONE es esperado (el estado vigente sigue activo), pero NO debe
    // haber alertas de causa raíz ni de reloj/divergencia.
    expect(codes(diags)).not.toContain("EVENTS_WITHOUT_NIP40");
    expect(codes(diags)).not.toContain("RELAY_DIVERGENCE");
    expect(codes(diags)).not.toContain("CLOCK_DRIFT");
    expect(diags.every((d) => d.severity !== "alert")).toBe(true);
  });

  it("marca COUNTED_WITHOUT_REFRESH cuando hubo muestras de conteo mucho después del último refresco", () => {
    // Reproduce el caso real del Ajedrez: último refresco `ngp:presencia` a las
    // 00:42, pero muestras live-2.0 con count>0 a las 01:20 (38 min después) sin
    // ningún refresco cercano ⇒ presencia contada sin renovarse = evento colgado.
    const lastRefreshMs = NOW * 1000 - 38 * 60_000;
    const diags = buildDiagnostics({
      coordEvents: [],
      slotLatest: new Map(),
      liveResolution: [],
      coordPerRelay: relaysAllOk(null),
      nowSec: NOW,
      liveSamples: [
        { sampledAtMs: NOW * 1000 - 60_000, count: 1 },
        { sampledAtMs: NOW * 1000 - 90_000, count: 1 },
      ],
      lastPresenceRefreshMs: lastRefreshMs,
    });
    expect(codes(diags)).toContain("COUNTED_WITHOUT_REFRESH");
  });

  it("NO marca COUNTED_WITHOUT_REFRESH si las muestras caen dentro de la holgura del refresco", () => {
    // Gameplay real: el refresco es reciente (throttle 1/min), las muestras están
    // dentro de la holgura ⇒ no es colgado.
    const diags = buildDiagnostics({
      coordEvents: [],
      slotLatest: new Map(),
      liveResolution: [],
      coordPerRelay: relaysAllOk(null),
      nowSec: NOW,
      liveSamples: [{ sampledAtMs: NOW * 1000 - 10_000, count: 1 }],
      lastPresenceRefreshMs: NOW * 1000 - 20_000, // refresco hace 20s
    });
    expect(codes(diags)).not.toContain("COUNTED_WITHOUT_REFRESH");
  });

  it("siempre incluye un SUMMARY con cuántos contaría el badge", () => {
    const e = toRE(ev({ pubkey: PK_A, created_at: NOW - 5, tags: [["d", "general"], ["a", COORD], ["expiration", String(NOW + 100)]] }));
    const diags = buildDiagnostics({
      coordEvents: [e],
      slotLatest: new Map([[e.pubkey, e]]),
      liveResolution: [
        { npub: e.npub, counted: true },
        { npub: "npub-x", counted: false },
      ],
      coordPerRelay: relaysAllOk(NOW - 5),
      nowSec: NOW,
    });
    const summary = diags.find((d) => d.code === "SUMMARY");
    expect(summary).toBeDefined();
    expect(summary?.message).toContain("1 jugador");
  });
});
