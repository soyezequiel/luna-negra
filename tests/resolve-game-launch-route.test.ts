import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gameFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    game: { findMany: mocks.gameFindMany },
  },
}));

async function resolveLaunch(url: unknown) {
  const { POST } = await import("@/app/api/games/resolve-launch/route");
  const response = await POST(new Request("http://local/api/games/resolve-launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  }));
  return { status: response.status, json: await response.json() };
}

beforeEach(() => {
  mocks.gameFindMany.mockReset().mockResolvedValue([
    {
      slug: "tetris",
      title: "TETRA",
      gameUrl: "https://tetris.example/play?locale=es",
      manualCaps: { bal: true, roomLink: true },
    },
  ]);
});

describe("POST /api/games/resolve-launch", () => {
  it("resolves a canonical room link without changing or returning the invite URL", async () => {
    const inviteUrl = "https://tetris.example/play?locale=es&join=ROOM1";

    const { status, json } = await resolveLaunch(inviteUrl);

    expect(status).toBe(200);
    expect(json).toEqual({
      slug: "tetris",
      title: "TETRA",
      balCompatible: true,
    });
    expect(json.url).toBeUndefined();
    expect(mocks.gameFindMany).toHaveBeenCalledWith({
      where: { status: "published", gameUrl: { not: null } },
      select: {
        slug: true,
        title: true,
        gameUrl: true,
        manualCaps: true,
      },
    });
  });

  it("does not resolve a different path on the same game host", async () => {
    const { status } = await resolveLaunch(
      "https://tetris.example/admin?locale=es&join=ROOM1",
    );

    expect(status).toBe(404);
  });

  it("requires query parameters declared by the registered game URL", async () => {
    const { status } = await resolveLaunch(
      "https://tetris.example/play?join=ROOM1",
    );

    expect(status).toBe(404);
  });

  it("rejects invalid or credentialed URLs before querying games", async () => {
    const { status } = await resolveLaunch(
      "https://user:secret@tetris.example/play?join=ROOM1",
    );

    expect(status).toBe(400);
    expect(mocks.gameFindMany).not.toHaveBeenCalled();
  });
});
