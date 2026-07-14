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
