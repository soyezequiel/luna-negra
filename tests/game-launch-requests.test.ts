import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gameFindFirst: vi.fn(),
  launchCreate: vi.fn(),
  launchDeleteMany: vi.fn(),
  mintRoomInvite: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    game: {
      findFirst: mocks.gameFindFirst,
    },
    gameLaunchRequest: {
      create: mocks.launchCreate,
      deleteMany: mocks.launchDeleteMany,
    },
  },
}));

vi.mock("@/lib/rooms", () => ({
  mintRoomInvite: mocks.mintRoomInvite,
}));

beforeEach(() => {
  mocks.gameFindFirst.mockReset().mockResolvedValue({
    id: "game1",
    slug: "tetris",
    title: "TETRA",
    gameUrl: "https://tetris.example",
  });
  mocks.launchCreate.mockReset().mockResolvedValue({});
  mocks.launchDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mocks.mintRoomInvite.mockReset().mockResolvedValue({
    ok: true,
    token: "invite-token",
    roomId: "ROOM1",
    host: false,
    slug: "tetris",
  });
});

describe("queueGameLaunchRequest", () => {
  it("mints a room invite for the guest and creates a launch request", async () => {
    const { queueGameLaunchRequest } = await import("@/lib/game-launch-requests");

    const queued = await queueGameLaunchRequest({
      providerId: "prov1",
      user: { id: "guest-user", npub: "npub-guest", pubkey: "guest" },
      roomId: "ROOM1",
      gameId: "game1",
    });

    expect(queued).toBe(true);
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
      { sub: "guest-user", npub: "npub-guest", pubkey: "guest" },
      "game1",
      "ROOM1",
    );
    expect(mocks.launchCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: "prov1",
        npub: "npub-guest",
        roomId: "ROOM1",
        inviteToken: "invite-token",
        slug: "tetris",
        title: "TETRA",
        gameUrl: "https://tetris.example",
        expiresAt: expect.any(Date),
      }),
    });
  });

  it("does not create a launch request when the room invite cannot be minted", async () => {
    const { queueGameLaunchRequest } = await import("@/lib/game-launch-requests");
    mocks.mintRoomInvite.mockResolvedValue({
      ok: false,
      code: "NOT_OWNED",
      message: "No tenes acceso a este juego",
      status: 403,
    });

    const queued = await queueGameLaunchRequest({
      providerId: "prov1",
      user: { id: "guest-user", npub: "npub-guest", pubkey: "guest" },
      roomId: "ROOM1",
      gameId: "game1",
    });

    expect(queued).toBe(false);
    expect(mocks.launchCreate).not.toHaveBeenCalled();
  });
});

describe("queueRoomLinkLaunchRequest", () => {
  it("queues the signed room link without minting a Luna-hosted room", async () => {
    const { queueRoomLinkLaunchRequest } = await import("@/lib/game-launch-requests");

    const queued = await queueRoomLinkLaunchRequest({
      providerId: "prov1",
      npub: "npub-guest",
      roomId: "ROOM1",
      lnInvite: "room-link-token",
      slug: "tetris",
      title: "TETRA",
      inviteUrl: "https://tetris.example/?lnRoom=ROOM1&lnInvite=room-link-token",
    });

    expect(queued).toBe(true);
    expect(mocks.mintRoomInvite).not.toHaveBeenCalled();
    expect(mocks.launchCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: "prov1",
        npub: "npub-guest",
        roomId: "ROOM1",
        inviteToken: "room-link-token",
        kind: "room-link",
        slug: "tetris",
        title: "TETRA",
        gameUrl: "https://tetris.example/?lnRoom=ROOM1&lnInvite=room-link-token",
      }),
    });
  });
});
