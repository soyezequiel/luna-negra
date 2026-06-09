import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerId: "prov1" as string | null,
  gameInviteCreate: vi.fn(),
  userFindUnique: vi.fn(),
  gameFindFirst: vi.fn(),
  mintRoomInvite: vi.fn(),
  createGameLaunchRequest: vi.fn(),
}));

vi.mock("@/lib/api-keys", () => ({
  verifyApiKey: vi.fn(async () => mocks.providerId),
}));

vi.mock("@/lib/nostr-social", () => ({
  pubkeyFromNpub: vi.fn((value: string) => (
    value.startsWith("npub-") ? value.slice("npub-".length) : null
  )),
  npubOf: vi.fn((pubkey: string) => `npub-${pubkey}`),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gameInvite: {
      create: mocks.gameInviteCreate,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
    game: {
      findFirst: mocks.gameFindFirst,
    },
  },
}));

vi.mock("@/lib/rooms", () => ({
  mintRoomInvite: mocks.mintRoomInvite,
}));

vi.mock("@/lib/game-launch-requests", () => ({
  createGameLaunchRequest: mocks.createGameLaunchRequest,
}));

async function postInvite(body: unknown) {
  const { POST } = await import("@/app/api/v1/friends/invite/route");
  const res = await POST(new Request("http://local/api/v1/friends/invite", {
    method: "POST",
    headers: {
      authorization: "Bearer ln_sk_test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  mocks.providerId = "prov1";
  mocks.gameInviteCreate.mockReset().mockResolvedValue({});
  mocks.userFindUnique.mockReset().mockResolvedValue({
    id: "user-guest",
    npub: "npub-guest",
    pubkey: "guest",
  });
  mocks.gameFindFirst.mockReset().mockResolvedValue({
    id: "game1",
    slug: "tetris",
    title: "TETRA",
    gameUrl: "https://tetris.example",
  });
  mocks.mintRoomInvite.mockReset().mockResolvedValue({
    ok: true,
    token: "invite-token",
    roomId: "ROOM1",
    host: false,
    slug: "tetris",
  });
  mocks.createGameLaunchRequest.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/v1/friends/invite", () => {
  it("queues a launch request for a known invited user when gameId is provided", async () => {
    const { status, json } = await postInvite({
      fromNpub: "npub-host",
      toNpub: "npub-guest",
      roomId: "ROOM1",
      inviteUrl: "https://tetris.example/?join=ROOM1",
      gameId: "game1",
    });

    expect(status).toBe(200);
    expect(json).toEqual({ delivered: true, launchQueued: true });
    expect(mocks.gameInviteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: "prov1",
        fromNpub: "npub-host",
        toNpub: "npub-guest",
        roomId: "ROOM1",
      }),
    });
    expect(mocks.gameFindFirst).toHaveBeenCalledWith({
      where: {
        id: "game1",
        providerId: "prov1",
        status: "published",
        gameUrl: { not: null },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        gameUrl: true,
      },
    });
    expect(mocks.mintRoomInvite).toHaveBeenCalledWith(
      { sub: "user-guest", npub: "npub-guest", pubkey: "guest" },
      "game1",
      "ROOM1",
    );
    expect(mocks.createGameLaunchRequest).toHaveBeenCalledWith({
      providerId: "prov1",
      npub: "npub-guest",
      roomId: "ROOM1",
      inviteToken: "invite-token",
      slug: "tetris",
      title: "TETRA",
      gameUrl: "https://tetris.example",
    });
  });

  it("keeps the Luna Negra toast invite even when launch cannot be queued", async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    const { status, json } = await postInvite({
      fromNpub: "npub-host",
      toNpub: "npub-guest",
      roomId: "ROOM1",
      inviteUrl: "https://tetris.example/?join=ROOM1",
      gameId: "game1",
    });

    expect(status).toBe(200);
    expect(json).toEqual({ delivered: false, launchQueued: false });
    expect(mocks.gameInviteCreate).toHaveBeenCalledTimes(1);
    expect(mocks.createGameLaunchRequest).not.toHaveBeenCalled();
  });
});
