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
    })!;

    rememberBalAuthorizationForSession(request);
    expect(hasBalAuthorization(request)).toBe(true);

    clearBalSessionAuthorizationsForGame("ajedrez");
    expect(hasBalAuthorization(request)).toBe(false);
  });
});
