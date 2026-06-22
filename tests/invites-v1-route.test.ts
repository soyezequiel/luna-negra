import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerId: "prov1" as string | null,
  gameInviteCreate: vi.fn(),
  userFindUnique: vi.fn(),
  queueGameLaunchRequest: vi.fn(),
  recordGameLaunchListener: vi.fn(),
  consumeGameLaunchRequest: vi.fn(),
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
  recordGameLaunchListener: mocks.recordGameLaunchListener,
  consumeGameLaunchRequest: mocks.consumeGameLaunchRequest,
}));

// El route endurece POST con anti-spoofing (el invitador debe ser jugador del
// proveedor) y una allowlist de hosts para `inviteUrl`. Aquí los damos por
// válidos: lo que se prueba es la lógica de encolado de la orden de entrada.
vi.mock("@/lib/provider-entitlement", () => ({
  npubHasLivePresence: vi.fn(async () => true),
  npubHasProviderEntitlement: vi.fn(async () => false),
  providerGameHosts: vi.fn(async () => new Set(["tetris.example"])),
}));

async function postInvite(body: unknown) {
  const { POST } = await import("@/app/api/v1/invites/route");
  const res = await POST(new Request("http://local/api/v1/invites", {
    method: "POST",
    headers: {
      authorization: "Bearer ln_sk_test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
}

async function getPendingLaunch(npub: string) {
  const { GET } = await import("@/app/api/v1/invites/route");
  const res = await GET(new Request(`http://local/api/v1/invites?npub=${encodeURIComponent(npub)}`, {
    headers: { authorization: "Bearer ln_sk_test" },
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
  mocks.recordGameLaunchListener.mockReset().mockResolvedValue(undefined);
  mocks.consumeGameLaunchRequest.mockReset().mockResolvedValue(null);
});

describe("POST /api/v1/invites", () => {
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

describe("GET /api/v1/invites", () => {
  it("records the listener and consumes the pending launch request", async () => {
    mocks.consumeGameLaunchRequest.mockResolvedValue({ id: "launch1", roomId: "ROOM1" });

    const { status, json } = await getPendingLaunch("npub-guest");

    expect(status).toBe(200);
    expect(json).toEqual({ request: { id: "launch1", roomId: "ROOM1" } });
    expect(mocks.recordGameLaunchListener).toHaveBeenCalledWith({
      providerId: "prov1",
      npub: "npub-guest",
    });
    expect(mocks.consumeGameLaunchRequest).toHaveBeenCalledWith({
      providerId: "prov1",
      npub: "npub-guest",
    });
  });

  it("rejects an invalid npub", async () => {
    const { status, json } = await getPendingLaunch("not-an-npub");
    expect(status).toBe(400);
    expect(json.error.code).toBe("INVALID_NPUB");
  });
});
