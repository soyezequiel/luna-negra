import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gameFindUnique: vi.fn(),
  purchaseFindUnique: vi.fn(),
  signRoomInvite: vi.fn(),
  queueRoomLinkLaunchRequest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({
    sub: "host-user",
    npub: "npub-host",
    pubkey: "host",
  })),
  signRoomInvite: mocks.signRoomInvite,
}));

vi.mock("@/lib/nostr-social", () => ({
  pubkeyFromNpub: vi.fn((value: string) => (
    value.startsWith("npub-") ? value.slice("npub-".length) : null
  )),
  npubOf: vi.fn((pubkey: string) => `npub-${pubkey}`),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    game: { findUnique: mocks.gameFindUnique },
    purchase: { findUnique: mocks.purchaseFindUnique },
  },
}));

vi.mock("@/lib/game-launch-requests", () => ({
  queueRoomLinkLaunchRequest: mocks.queueRoomLinkLaunchRequest,
}));

async function postRoomLink(body: unknown) {
  const { POST } = await import("@/app/api/v1/rooms/invite/route");
  const response = await POST(new Request("http://local/api/v1/rooms/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, json: await response.json() };
}

beforeEach(() => {
  mocks.gameFindUnique.mockReset().mockResolvedValue({
    id: "game1",
    providerId: "prov1",
    slug: "tetris",
    title: "TETRA",
    gameUrl: "https://tetris.example/",
    status: "published",
    priceSats: 0,
  });
  mocks.purchaseFindUnique.mockReset();
  mocks.signRoomInvite.mockReset().mockResolvedValue("signed-room-link");
  mocks.queueRoomLinkLaunchRequest.mockReset().mockResolvedValue(true);
});

describe("POST /api/v1/rooms/invite", () => {
  it("queues a directed Luna Room Link for a game that is already open", async () => {
    const { status, json } = await postRoomLink({
      gameId: "game1",
      roomId: "ROOM1",
      toNpub: "npub-guest",
    });

    expect(status).toBe(200);
    expect(json).toMatchObject({
      roomId: "ROOM1",
      lnInvite: "signed-room-link",
      launchQueued: true,
    });
    expect(json.inviteUrl).toContain("lnRoom=ROOM1");
    expect(mocks.queueRoomLinkLaunchRequest).toHaveBeenCalledWith({
      providerId: "prov1",
      npub: "npub-guest",
      roomId: "ROOM1",
      lnInvite: "signed-room-link",
      slug: "tetris",
      title: "TETRA",
      inviteUrl: json.inviteUrl,
    });
  });

  it("does not queue a public room link without a recipient", async () => {
    const { status, json } = await postRoomLink({ gameId: "game1", roomId: "ROOM1" });

    expect(status).toBe(200);
    expect(json.launchQueued).toBe(false);
    expect(mocks.queueRoomLinkLaunchRequest).not.toHaveBeenCalled();
  });
});
