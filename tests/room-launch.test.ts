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
  name: string;
  opener: unknown;
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
    name: "",
    opener: {},
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
  it("waits for BAL preauthorization before opening an invited room", async () => {
    const reservedWin = createFakeGameWindow();
    const authorizedWin = createFakeGameWindow();
    const open = vi.fn()
      .mockReturnValueOnce(reservedWin)
      .mockReturnValueOnce(authorizedWin);
    let continueLaunch:
      | ((choice: boolean | null, resumedFromPrompt: boolean) => void)
      | undefined;
    const preauthorize = vi.fn((
      _game: unknown,
      continuation: typeof continueLaunch,
    ) => {
      continueLaunch = continuation;
      return true;
    });
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open,
    });
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({
      token: "invite-token",
      roomId: "ROOM1",
      slug: "tetris",
      title: "TETRA",
      gameUrl: "https://tetris.example/play",
      balCompatible: true,
      openGame: false,
    })));

    const { joinRoomAndPlay } = await import("@/lib/room-launch");
    const joining = joinRoomAndPlay({
      slug: "tetris",
      roomId: "ROOM1",
      preauthorize,
    });

    await vi.waitFor(() => expect(preauthorize).toHaveBeenCalledTimes(1));
    expect(preauthorize.mock.calls[0][0]).toEqual({
      gameId: "tetris",
      gameName: "TETRA",
      gameUrl: "https://tetris.example/play",
      balCompatible: true,
    });
    expect(reservedWin.close).toHaveBeenCalledTimes(1);
    expect(authorizedWin.location.href).toBe("");

    continueLaunch?.(true, true);
    await joining;

    expect(open).toHaveBeenLastCalledWith("", "luna-negra-game-tetris");
    expect(authorizedWin.location.href).toBe(
      "https://tetris.example/play?lnOrigin=https%3A%2F%2Fluna.example&inviteToken=invite-token&room=ROOM1",
    );
  });

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
        balCompatible: true,
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
        balCompatible: true,
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
          balCompatible: true,
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

describe("openExternalGameLink", () => {
  it("shows preauthorization before navigating a received BAL room link", async () => {
    const reservedWin = createFakeGameWindow();
    const authorizedWin = createFakeGameWindow();
    const localStorage = memoryStorage();
    const open = vi.fn()
      .mockReturnValueOnce(reservedWin)
      .mockReturnValueOnce(authorizedWin);
    let continueLaunch:
      | ((choice: boolean | null, resumedFromPrompt: boolean) => void)
      | undefined;
    const preauthorize = vi.fn((
      _game: unknown,
      continuation: typeof continueLaunch,
    ) => {
      continueLaunch = continuation;
      return true;
    });
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      localStorage,
      open,
    });
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({
      slug: "tetris",
      title: "TETRA",
      balCompatible: true,
    })));
    const inviteUrl = "https://tetris.example/play?join=ROOM1";

    const { openExternalGameLink } = await import("@/lib/room-launch");
    const opening = openExternalGameLink(inviteUrl, preauthorize);

    await vi.waitFor(() => expect(preauthorize).toHaveBeenCalledTimes(1));
    expect(preauthorize.mock.calls[0][0]).toEqual({
      gameId: "tetris",
      gameName: "TETRA",
      gameUrl: inviteUrl,
      balCompatible: true,
    });
    expect(reservedWin.close).toHaveBeenCalledTimes(1);
    expect(authorizedWin.location.href).toBe("");

    continueLaunch?.(true, true);
    const result = await opening;

    expect(result).toEqual({ ok: true });
    expect(open).toHaveBeenLastCalledWith(
      "https://tetris.example/play?join=ROOM1&lnOrigin=https%3A%2F%2Fluna.example",
      "luna-negra-game-tetris",
    );
  });

  it("cancels a pending external launch without opening the game", async () => {
    const reservedWin = createFakeGameWindow();
    const localStorage = memoryStorage();
    const open = vi.fn(() => reservedWin);
    let continueLaunch:
      | ((choice: boolean | null, resumedFromPrompt: boolean) => void)
      | undefined;
    const preauthorize = vi.fn((
      _game: unknown,
      continuation: typeof continueLaunch,
    ) => {
      continueLaunch = continuation;
      return true;
    });
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      localStorage,
      open,
    });
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({
      slug: "tetris",
      title: "TETRA",
      balCompatible: true,
    })));

    const { openExternalGameLink } = await import("@/lib/room-launch");
    const opening = openExternalGameLink(
      "https://tetris.example/play?join=ROOM1",
      preauthorize,
    );
    await vi.waitFor(() => expect(continueLaunch).toBeTypeOf("function"));

    continueLaunch?.(null, true);

    await expect(opening).resolves.toEqual({ ok: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(reservedWin.close).toHaveBeenCalledTimes(1);
    expect(reservedWin.location.href).toBe("");
  });

  it("opens with the normal game login when preauthorization is declined", async () => {
    const reservedWin = createFakeGameWindow();
    const independentWin = createFakeGameWindow();
    const localStorage = memoryStorage();
    const open = vi.fn()
      .mockReturnValueOnce(reservedWin)
      .mockReturnValueOnce(independentWin);
    let continueLaunch:
      | ((choice: boolean | null, resumedFromPrompt: boolean) => void)
      | undefined;
    const preauthorize = vi.fn((
      _game: unknown,
      continuation: typeof continueLaunch,
    ) => {
      continueLaunch = continuation;
      return true;
    });
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      localStorage,
      open,
    });
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({
      slug: "tetris",
      title: "TETRA",
      balCompatible: true,
    })));

    const { openExternalGameLink } = await import("@/lib/room-launch");
    const opening = openExternalGameLink(
      "https://tetris.example/play?join=ROOM1",
      preauthorize,
    );
    await vi.waitFor(() => expect(continueLaunch).toBeTypeOf("function"));

    continueLaunch?.(false, true);

    await expect(opening).resolves.toEqual({ ok: true });
    expect(open).toHaveBeenLastCalledWith(
      "https://tetris.example/play?join=ROOM1&lnBal=off",
      "luna-negra-game-tetris",
    );
  });

  it("keeps the received invitation URL untouched in independent mode", async () => {
    const gameWin = createFakeGameWindow();
    const localStorage = memoryStorage();
    const open = vi.fn(() => gameWin);
    const fetch = vi.fn();
    localStorage.setItem("luna-negra:app-mode.v1", "independent");
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      localStorage,
      open,
    });
    vi.stubGlobal("fetch", fetch);
    const inviteUrl = "https://tetris.example/play?join=ROOM1";

    const { openExternalGameLink } = await import("@/lib/room-launch");
    const result = await openExternalGameLink(inviteUrl);

    expect(result).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith(inviteUrl, "_blank");
    expect(fetch).not.toHaveBeenCalled();
    expect(gameWin.opener).toBeNull();
  });

  it("launches a received room link through BAL when the recipient enabled it", async () => {
    const gameWin = createFakeGameWindow();
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const open = vi.fn(() => gameWin);
    const fetch = vi.fn(async () => okResponse({
      slug: "tetris",
      title: "TETRA",
      balCompatible: true,
    }));
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      localStorage,
      open,
    });
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("fetch", fetch);
    const inviteUrl = "https://tetris.example/play?join=ROOM1";

    const { openExternalGameLink } = await import("@/lib/room-launch");
    const result = await openExternalGameLink(inviteUrl);

    expect(result).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(fetch).toHaveBeenCalledWith("/api/games/resolve-launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: inviteUrl }),
    });
    expect(gameWin.name).toBe("luna-negra-game-tetris");
    expect(gameWin.location.href).toBe(
      "https://tetris.example/play?join=ROOM1&lnOrigin=https%3A%2F%2Fluna.example",
    );
    expect(JSON.parse(
      sessionStorage.getItem("luna-negra:bal-game-binding:tetris")!,
    )).toEqual({
      gameId: "tetris",
      gameName: "TETRA",
      origin: "https://tetris.example",
    });
  });

  it("falls back to the original link when the game cannot use BAL", async () => {
    const gameWin = createFakeGameWindow();
    const localStorage = memoryStorage();
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      localStorage,
      open: vi.fn(() => gameWin),
    });
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({
      slug: "tetris",
      title: "TETRA",
      balCompatible: false,
    })));
    const inviteUrl = "https://tetris.example/play?join=ROOM1";

    const { openExternalGameLink } = await import("@/lib/room-launch");
    const result = await openExternalGameLink(inviteUrl);

    expect(result).toEqual({ ok: true });
    expect(gameWin.location.href).toBe(inviteUrl);
    expect(gameWin.opener).toBeNull();
  });

  it("reports popup blocking before resolving the game", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      localStorage: memoryStorage(),
      open: vi.fn(() => null),
    });
    vi.stubGlobal("fetch", fetch);
    const inviteUrl = "https://tetris.example/play?join=ROOM1";

    const { openExternalGameLink } = await import("@/lib/room-launch");
    const result = await openExternalGameLink(inviteUrl);

    expect(result).toEqual({
      ok: false,
      reason: "popup-blocked",
      dest: inviteUrl,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("launchStandaloneGame", () => {
  it("disables BAL for a game that the provider did not declare compatible", async () => {
    const gameWin = createFakeGameWindow();
    const open = vi.fn(() => gameWin);
    vi.stubGlobal("window", {
      location: { origin: "https://luna.example" },
      open,
    });

    const { launchStandaloneGame } = await import("@/lib/room-launch");
    const result = launchStandaloneGame({
      gameUrl: "https://tetris.example/play",
      slug: "tetris",
      title: "TETRA",
      balCompatible: false,
    });

    expect(result).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith(
      "https://tetris.example/play?lnBal=off",
      "luna-negra-game-tetris",
    );
  });

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
      balCompatible: true,
    });
    expect(request).not.toBeNull();
    bal.grantBalPreauthorization(request!, false);
    roomLaunch.registerGameWindow(
      "ajedrez",
      gameWin as unknown as Window,
      "https://ajedrez.example/play",
      "Ajedrez",
      true,
      true,
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
      balCompatible: true,
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
      balCompatible: true,
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
