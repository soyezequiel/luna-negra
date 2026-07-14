import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BalConsentRequest } from "nostr-game-protocol/bal";

function memoryStorage(): Storage {
  const records = new Map<string, string>();
  return {
    get length() { return records.size; },
    clear: () => records.clear(),
    getItem: (key) => records.get(key) ?? null,
    key: (index) => [...records.keys()][index] ?? null,
    removeItem: (key) => { records.delete(key); },
    setItem: (key, value) => { records.set(key, value); },
  };
}

const request: BalConsentRequest = {
  gameId: "ajedrez",
  gameName: "Ajedrez",
  origin: "https://ajedrez.example",
  identityId: "user-1",
  pubkey: "a".repeat(64),
  identitySource: "nsec",
  permissions: ["get_public_key", "sign_event:1"],
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-14T20:00:00.000Z"));
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("window", {
    location: { origin: "https://luna.example" },
    dispatchEvent: vi.fn(),
  });
});

describe("BAL session authorization", () => {
  it("survives a game reload without becoming a remembered authorization", async () => {
    const bal = await import("@/lib/bal-launcher");

    bal.rememberBalAuthorizationForSession(request);

    expect(await bal.createLunaBalAuthorizationStore().list()).toMatchObject([
      { gameId: "ajedrez", identityId: "user-1" },
    ]);
    expect(bal.listBalAuthorizations()).toEqual([]);
  });

  it("removes the session grant when the game window really closes", async () => {
    const bal = await import("@/lib/bal-launcher");
    const peer = {} as Window;
    bal.rememberBalAuthorizationForSession(request);
    bal.registerBalGameWindow("ajedrez", "Ajedrez", peer, request.origin);

    bal.unregisterBalGameWindow(peer);

    expect(await bal.createLunaBalAuthorizationStore().list()).toEqual([]);
  });
});

describe("BAL preauthorization", () => {
  it("builds the trusted Ajedrez grant with the exact game origin and manifest", async () => {
    const bal = await import("@/lib/bal-launcher");

    const preauthorization = bal.createBalPreauthorizationRequest({
      gameId: "ajedrez",
      gameName: "Ajedrez",
      gameUrl: "https://ajedrez.example/play?room=1",
      identityId: "user-1",
      pubkey: "a".repeat(64),
      identitySource: "nsec",
    });

    expect(preauthorization).toMatchObject({
      gameId: "ajedrez",
      origin: "https://ajedrez.example",
      identityId: "user-1",
      identitySource: "nsec",
    });
    expect(preauthorization?.permissions).toEqual([
      "get_public_key",
      "sign_event:1",
      "sign_event:13",
      "sign_event:22242",
      "sign_event:30315",
      "sign_event:31339",
      "sign_event:9734",
      "nip04_encrypt",
      "nip04_decrypt",
      "nip44_encrypt",
      "nip44_decrypt",
    ]);
    expect(bal.createBalPreauthorizationRequest({
      gameId: "otro-juego",
      gameName: "Otro",
      gameUrl: "https://otro.example",
      identityId: "user-1",
      pubkey: "a".repeat(64),
      identitySource: "nsec",
    })).toBeNull();
  });

  it("grants the next launch without turning a one-time choice into a remembered grant", async () => {
    const bal = await import("@/lib/bal-launcher");

    expect(bal.hasBalAuthorization(request)).toBe(false);
    bal.grantBalPreauthorization(request, false);

    expect(bal.hasBalAuthorization(request)).toBe(true);
    expect(bal.listBalAuthorizations()).toEqual([]);
  });

  it("consumes a prelaunch denial once even if the game asks for different permissions", async () => {
    const bal = await import("@/lib/bal-launcher");
    bal.suppressNextBalConsent(request);

    expect(bal.consumeSuppressedBalConsent({
      ...request,
      permissions: [...request.permissions, "sign_event:13"],
    })).toBe(true);
    expect(bal.consumeSuppressedBalConsent(request)).toBe(false);
  });
});
