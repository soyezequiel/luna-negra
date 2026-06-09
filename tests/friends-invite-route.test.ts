import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerId: "prov1" as string | null,
  gameInviteCreate: vi.fn(),
  userFindUnique: vi.fn(),
  queueGameLaunchRequest: vi.fn(),
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
  },
}));

vi.mock("@/lib/game-launch-requests", () => ({
  queueGameLaunchRequest: mocks.queueGameLaunchRequest,
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
  mocks.queueGameLaunchRequest.mockReset().mockResolvedValue(true);
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
    expect(mocks.queueGameLaunchRequest).toHaveBeenCalledWith({
      providerId: "prov1",
      user: { id: "user-guest", npub: "npub-guest", pubkey: "guest" },
      roomId: "ROOM1",
      gameId: "game1",
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
    expect(mocks.queueGameLaunchRequest).not.toHaveBeenCalled();
  });
});
