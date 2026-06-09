import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: {
    sub: "host-user",
    npub: "npub-host",
    pubkey: "host",
  } as { sub: string; npub: string; pubkey: string } | null,
  gameFindUnique: vi.fn(),
  purchaseFindUnique: vi.fn(),
  gameInviteCreate: vi.fn(),
  userFindUnique: vi.fn(),
  queueGameLaunchRequest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
}));

vi.mock("@/lib/nostr-social", () => ({
  pubkeyFromNpub: vi.fn((value: string) => (
    value.startsWith("npub-") ? value.slice("npub-".length) : null
  )),
  npubOf: vi.fn((pubkey: string) => `npub-${pubkey}`),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    game: {
      findUnique: mocks.gameFindUnique,
    },
    purchase: {
      findUnique: mocks.purchaseFindUnique,
    },
    gameInvite: {
      create: mocks.gameInviteCreate,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
}));

vi.mock("@/lib/site-url", () => ({
  siteUrl: vi.fn(() => "https://luna.example"),
}));

vi.mock("@/lib/game-launch-requests", () => ({
  queueGameLaunchRequest: mocks.queueGameLaunchRequest,
}));

async function postInvite(body: unknown) {
  const { POST } = await import("@/app/api/invites/route");
  const res = await POST(new Request("https://luna.example/api/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  mocks.session = {
    sub: "host-user",
    npub: "npub-host",
    pubkey: "host",
  };
  mocks.gameFindUnique.mockReset().mockResolvedValue({
    id: "game1",
    providerId: "prov1",
    slug: "tetris",
    title: "TETRA",
    status: "published",
    priceSats: 0,
  });
  mocks.purchaseFindUnique.mockReset().mockResolvedValue(null);
  mocks.gameInviteCreate.mockReset().mockResolvedValue({});
  mocks.userFindUnique.mockReset().mockResolvedValue({
    id: "guest-user",
    npub: "npub-guest",
    pubkey: "guest",
  });
  mocks.queueGameLaunchRequest.mockReset().mockResolvedValue(true);
});

describe("POST /api/invites", () => {
  it("queues a Tetris launch request when a known Luna Negra user is invited", async () => {
    const { status, json } = await postInvite({
      gameId: "game1",
      roomId: "ROOM1",
      toNpub: "npub-guest",
    });

    expect(status).toBe(200);
    expect(json).toEqual({
      ok: true,
      delivered: true,
      launchQueued: true,
      inviteUrl: "https://luna.example/game/tetris?room=ROOM1",
      title: "TETRA",
    });
    expect(mocks.gameInviteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: "prov1",
        fromNpub: "npub-host",
        toNpub: "npub-guest",
        roomId: "ROOM1",
        inviteUrl: "https://luna.example/game/tetris?room=ROOM1",
      }),
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { npub: "npub-guest" },
      select: { id: true, npub: true, pubkey: true },
    });
    expect(mocks.queueGameLaunchRequest).toHaveBeenCalledWith({
      providerId: "prov1",
      user: { id: "guest-user", npub: "npub-guest", pubkey: "guest" },
      roomId: "ROOM1",
      gameId: "game1",
    });
  });

  it("keeps the Luna Negra toast invite when the guest is not a known user", async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    const { status, json } = await postInvite({
      gameId: "game1",
      roomId: "ROOM1",
      toNpub: "npub-guest",
    });

    expect(status).toBe(200);
    expect(json).toEqual({
      ok: true,
      delivered: false,
      launchQueued: false,
      inviteUrl: "https://luna.example/game/tetris?room=ROOM1",
      title: "TETRA",
    });
    expect(mocks.gameInviteCreate).toHaveBeenCalledTimes(1);
    expect(mocks.queueGameLaunchRequest).not.toHaveBeenCalled();
  });
});
