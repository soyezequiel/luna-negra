import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeWindow = {
  postMessage: ReturnType<typeof vi.fn>;
};

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

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("BAL consent UX", () => {
  it("notifies only the registered game window with the exact origin", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("window", { location: { origin: "https://luna.example" } });
    const gameWindow: FakeWindow = { postMessage: vi.fn() };
    const {
      matchesRegisteredBalGameWindow,
      notifyBalConsentRequired,
      registerBalGameWindow,
    } = await import("@/lib/bal-launcher");

    registerBalGameWindow(
      "ajedrez",
      "Ajedrez",
      gameWindow as unknown as Window,
      "https://ajedrez.example/play",
      true,
    );

    notifyBalConsentRequired("ajedrez", "https://otro.example");
    expect(gameWindow.postMessage).not.toHaveBeenCalled();

    notifyBalConsentRequired("ajedrez", "https://ajedrez.example");
    expect(gameWindow.postMessage).toHaveBeenCalledOnce();
    expect(gameWindow.postMessage).toHaveBeenCalledWith(
      { type: "luna-negra:bal-consent-required", gameId: "ajedrez" },
      "https://ajedrez.example",
    );
    expect(matchesRegisteredBalGameWindow(
      gameWindow as unknown as Window,
      "https://ajedrez.example",
      "ajedrez",
    )).toBe(true);
    expect(matchesRegisteredBalGameWindow(
      gameWindow as unknown as Window,
      "https://otro.example",
      "ajedrez",
    )).toBe(false);
  });

  it("recovers the exact game binding after the launcher reloads", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("window", { location: { origin: "https://luna.example" } });
    const originalPeer = { postMessage: vi.fn() } as unknown as Window;
    const firstModule = await import("@/lib/bal-launcher");
    firstModule.registerBalGameWindow(
      "ajedrez",
      "Ajedrez",
      originalPeer,
      "https://ajedrez.example/play",
      true,
    );

    // Simula un reload completo del launcher: el Map del módulo desaparece,
    // pero sessionStorage y la pestaña del juego siguen vivos.
    vi.resetModules();
    const reloaded = await import("@/lib/bal-launcher");
    const currentPeer = { postMessage: vi.fn() } as unknown as Window;

    expect(reloaded.lunaBalGameRegistry.resolve({
      data: {},
      origin: "https://ajedrez.example",
      peer: currentPeer,
    }, "ajedrez")).toMatchObject({
      gameId: "ajedrez",
      gameName: "Ajedrez",
      origin: "https://ajedrez.example",
      peer: currentPeer,
    });

    expect(reloaded.matchesRegisteredBalGameWindow(
      { postMessage: vi.fn() } as unknown as Window,
      "https://evil.example",
      "ajedrez",
    )).toBe(false);
  });

  it("forgets a one-time grant when the last game tab closes", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", { location: { origin: "https://luna.example" } });
    const {
      clearBalSessionAuthorizationsForGame,
      createBalPreauthorizationRequest,
      hasBalAuthorization,
      rememberBalAuthorizationForSession,
    } = await import("@/lib/bal-launcher");
    const request = createBalPreauthorizationRequest({
      gameId: "ajedrez",
      gameName: "Ajedrez",
      gameUrl: "https://ajedrez.example/play",
      identityId: "user-1",
      pubkey: "a".repeat(64),
      identitySource: "email",
      balCompatible: true,
    })!;

    rememberBalAuthorizationForSession(request);
    expect(hasBalAuthorization(request)).toBe(true);

    clearBalSessionAuthorizationsForGame("ajedrez");
    expect(hasBalAuthorization(request)).toBe(false);
  });

  it("restores snapshots only after a real reload marker", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("window", { location: { origin: "https://luna.example" } });
    const first = await import("@/lib/bal-launcher");
    first.registerBalGameWindow(
      "ajedrez",
      "Ajedrez",
      { postMessage: vi.fn() } as unknown as Window,
      "https://ajedrez.example/play",
      true,
    );
    first.createLunaBalSessionStore().save({
      requestId: "request-1",
      nonce: "nonce-1",
      gameId: "ajedrez",
      gameName: "Ajedrez",
      origin: "https://ajedrez.example",
      authorizationId: "authorization-1",
      identityId: "user-1",
      identitySource: "nsec",
      remote: {
        version: 1,
        clientPubkey: "b".repeat(64),
        identityPubkey: "a".repeat(64),
        serviceSecret: "c".repeat(64),
        permissions: ["get_public_key"],
        relays: ["wss://relay.example"],
        expiresAt: Date.now() + 60_000,
        seenEventIds: [],
      },
    });
    expect(first.prepareBalLauncherReload()).toBe(true);

    vi.resetModules();
    const reloaded = await import("@/lib/bal-launcher");
    expect(await reloaded.createLunaBalSessionStore().list()).toHaveLength(1);

    // Una pestaña duplicada puede copiar sessionStorage, pero sin `pagehide`
    // no debe levantar la clave efímera del remoto original.
    vi.resetModules();
    const duplicated = await import("@/lib/bal-launcher");
    expect(await duplicated.createLunaBalSessionStore().list()).toEqual([]);
  });
});
