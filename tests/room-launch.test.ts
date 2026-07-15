import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  watchGameWindow: vi.fn(),
}));

vi.mock("@/lib/invite", () => ({
  inviteHref: ({ slug, roomId }: { slug: string; roomId: string }) =>
    `/game/${slug}?room=${encodeURIComponent(roomId)}`,
  watchGameWindow: mocks.watchGameWindow,
}));

type FakeWindow = {
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  location: { href: string; origin?: string };
  postMessage: ReturnType<typeof vi.fn>;
};

function createFakeGameWindow(): FakeWindow {
  return {
    closed: false,
    close: vi.fn(function (this: FakeWindow) {
      this.closed = true;
    }),
    focus: vi.fn(),
    location: { href: "" },
    postMessage: vi.fn(),
  };
}

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

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
  mocks.watchGameWindow.mockReset();
});

describe("joinRoomAndPlay", () => {
  it("opens room invitations without BAL when independent mode is stored", async () => {
    const gameWin = createFakeGameWindow();
    const localStorage = memoryStorage();
    localStorage.setItem("luna-negra:app-mode.v1", "independent");
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      localStorage,
      open: vi.fn(() => gameWin),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({
        token: "invite-token",
        roomId: "ROOM1",
        slug: "tetris",
        title: "TETRA",
        gameUrl: "https://tetris.example/play",
        openGame: false,
      })),
    );

    const { joinRoomAndPlay } = await import("@/lib/room-launch");
    await joinRoomAndPlay({ slug: "tetris", roomId: "ROOM1" });

    expect(gameWin.location.href).toBe(
      "https://tetris.example/play?lnBal=off&inviteToken=invite-token&room=ROOM1",
    );
  });

  it("reserves a game window before joining and navigates it when the game is closed", async () => {
    const events: string[] = [];
    const gameWin = createFakeGameWindow();
    const open = vi.fn(() => {
      events.push("open");
      return gameWin;
    });
    const fetch = vi.fn(async () => {
      events.push("fetch");
      return okResponse({
        token: "invite-token",
        roomId: "ROOM1",
        host: false,
        slug: "tetris",
        title: "TETRA",
        gameUrl: "https://tetris.example/play",
        openGame: false,
      });
    });
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open,
    });
    vi.stubGlobal("fetch", fetch);

    const { joinRoomAndPlay } = await import("@/lib/room-launch");

    await joinRoomAndPlay({ slug: "tetris", roomId: "ROOM1" });

    expect(events).toEqual(["open", "fetch"]);
    expect(open).toHaveBeenCalledWith("", "luna-negra-game-tetris");
    expect(gameWin.close).not.toHaveBeenCalled();
    expect(gameWin.location.href).toBe(
      "https://tetris.example/play?lnOrigin=https%3A%2F%2Fluna.example&inviteToken=invite-token&room=ROOM1",
    );
  });

  it("reports popup-blocked via onBlocked when window.open returns null", async () => {
    const onBlocked = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open: vi.fn(() => null),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          token: "invite-token",
          roomId: "ROOM1",
          host: false,
          slug: "tetris",
          title: "TETRA",
          gameUrl: "https://tetris.example/play",
          openGame: false,
        }),
      ),
    );

    const { joinRoomAndPlay } = await import("@/lib/room-launch");

    await joinRoomAndPlay({ slug: "tetris", roomId: "ROOM1", onBlocked, onError });

    expect(onBlocked).toHaveBeenCalledWith(
      "https://tetris.example/play?lnOrigin=https%3A%2F%2Fluna.example&inviteToken=invite-token&room=ROOM1",
    );
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.watchGameWindow).not.toHaveBeenCalled();
  });

  it("falls back to onError with the popup message when onBlocked is not provided", async () => {
    const onError = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open: vi.fn(() => null),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          token: "invite-token",
          roomId: "ROOM1",
          host: false,
          slug: "tetris",
          title: "TETRA",
          gameUrl: "https://tetris.example/play",
          openGame: false,
        }),
      ),
    );

    const { joinRoomAndPlay, POPUP_BLOCKED_BODY } = await import(
      "@/lib/room-launch"
    );

    await joinRoomAndPlay({ slug: "tetris", roomId: "ROOM1", onError });

    expect(onError).toHaveBeenCalledWith(POPUP_BLOCKED_BODY);
  });

  it("closes the reserved window when an already-open game should consume the request", async () => {
    const gameWin = createFakeGameWindow();
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open: vi.fn(() => gameWin),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          token: "invite-token",
          roomId: "ROOM1",
          host: false,
          slug: "tetris",
          title: "TETRA",
          gameUrl: "https://tetris.example/play",
          openGame: true,
        }),
      ),
    );

    const { joinRoomAndPlay } = await import("@/lib/room-launch");

    await joinRoomAndPlay({ slug: "tetris", roomId: "ROOM1" });

    expect(gameWin.close).toHaveBeenCalledTimes(1);
    expect(gameWin.location.href).toBe("");
  });
});

describe("launchStandaloneGame", () => {
  it("uses the persisted independent mode for regular launches", async () => {
    const gameWin = createFakeGameWindow();
    const localStorage = memoryStorage();
    const open = vi.fn(() => gameWin);
    localStorage.setItem("luna-negra:app-mode.v1", "independent");
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      localStorage,
      open,
    });

    const { launchStandaloneGame } = await import("@/lib/room-launch");
    const result = launchStandaloneGame({
      gameUrl: "https://tetris.example/play",
      slug: "tetris",
      title: "TETRA",
    });

    expect(result).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith(
      "https://tetris.example/play?lnBal=off",
      "luna-negra-game-tetris",
    );
  });

  it("clears a one-time BAL grant immediately when the previous game window is closed", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const gameWin = createFakeGameWindow();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open: vi.fn(() => gameWin),
      dispatchEvent: vi.fn(),
    });

    const bal = await import("@/lib/bal-launcher");
    const roomLaunch = await import("@/lib/room-launch");
    const request = bal.createBalPreauthorizationRequest({
      gameId: "ajedrez",
      gameName: "Ajedrez",
      gameUrl: "https://ajedrez.example/play",
      identityId: "user-1",
      pubkey: "a".repeat(64),
      identitySource: "nsec",
    });
    expect(request).not.toBeNull();
    bal.grantBalPreauthorization(request!, false);
    roomLaunch.registerGameWindow(
      "ajedrez",
      gameWin as unknown as Window,
      "https://ajedrez.example/play",
      "Ajedrez",
    );
    expect(bal.hasBalAuthorization(request!)).toBe(true);

    gameWin.closed = true;

    expect(roomLaunch.getOpenGameWindow("ajedrez")).toBeNull();
    expect(bal.hasBalAuthorization(request!)).toBe(false);
  });

  it("navigates a pre-opened window instead of opening a new one", async () => {
    const gameWin = createFakeGameWindow();
    const open = vi.fn(() => {
      throw new Error("no debería abrirse otra ventana");
    });
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open,
    });

    const { launchStandaloneGame } = await import("@/lib/room-launch");

    const result = launchStandaloneGame({
      gameUrl: "https://tetris.example/play",
      slug: "tetris",
      title: "TETRA",
      win: gameWin as unknown as Window,
    });

    expect(result).toEqual({ ok: true });
    expect(open).not.toHaveBeenCalled();
    expect(gameWin.location.href).toBe(
      "https://tetris.example/play?lnOrigin=https%3A%2F%2Fluna.example",
    );
  });

  it("returns popup-blocked with the destination URL when no window can be opened", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open: vi.fn(() => null),
    });

    const { launchStandaloneGame } = await import("@/lib/room-launch");

    const result = launchStandaloneGame({
      gameUrl: "https://tetris.example/play",
      slug: "tetris",
      title: "TETRA",
    });

    expect(result).toEqual({
      ok: false,
      reason: "popup-blocked",
      dest: "https://tetris.example/play?lnOrigin=https%3A%2F%2Fluna.example",
    });
  });

  it("launches without BAL when the player declines the pre-permission", async () => {
    const gameWin = createFakeGameWindow();
    const open = vi.fn(() => gameWin);
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open,
    });

    const { launchStandaloneGame } = await import("@/lib/room-launch");

    const result = launchStandaloneGame({
      gameUrl: "https://ajedrez.example/play?lnOrigin=https%3A%2F%2Fold.example",
      slug: "ajedrez",
      title: "Ajedrez",
      balEnabled: false,
    });

    expect(result).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith(
      "https://ajedrez.example/play?lnBal=off",
      "luna-negra-game-ajedrez",
    );
  });

  it("notifies opened game windows when Luna Negra logs out", async () => {
    const gameWin = createFakeGameWindow();
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open: vi.fn(() => gameWin),
    });

    const { launchStandaloneGame, notifyOpenGameWindowsLogout } = await import(
      "@/lib/room-launch"
    );

    const result = launchStandaloneGame({
      gameUrl: "https://tetris.example/play",
      slug: "tetris",
      title: "TETRA",
    });
    expect(result).toEqual({ ok: true });

    notifyOpenGameWindowsLogout();

    expect(gameWin.postMessage).toHaveBeenCalledWith(
      { type: "luna-negra:logout" },
      "https://tetris.example",
    );
  });
});
