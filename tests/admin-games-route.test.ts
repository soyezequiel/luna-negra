import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { pubkey: "admin-pubkey" } as { pubkey: string } | null,
  isAdmin: vi.fn(() => true),
  gameFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
}));

vi.mock("@/lib/admin", () => ({
  isAdmin: mocks.isAdmin,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    game: { findMany: mocks.gameFindMany },
  },
}));

beforeEach(() => {
  mocks.session = { pubkey: "admin-pubkey" };
  mocks.isAdmin.mockReset().mockReturnValue(true);
  mocks.gameFindMany.mockReset();
});

describe("admin games route", () => {
  it("returns drafts with their provider owner, oldest first", async () => {
    const draft = {
      id: "draft-1",
      title: "Juego sin enviar",
      slug: "juego-sin-enviar",
      priceSats: 0,
      description: "Listo",
      categories: ["arcade"],
      gameUrl: "https://game.example",
      coverUrl: "https://cdn.example/cover.jpg",
      horizontalCoverUrl: null,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      provider: {
        name: "Estudio Uno",
        owner: { displayName: "Ana", npub: "npub1owner" },
      },
    };
    mocks.gameFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([draft])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { GET } = await import("@/app/api/admin/games/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.drafts).toEqual([
      expect.objectContaining({
        id: "draft-1",
        provider: {
          name: "Estudio Uno",
          owner: { displayName: "Ana", npub: "npub1owner" },
        },
      }),
    ]);
    expect(mocks.gameFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { status: "draft" },
        orderBy: { createdAt: "asc" },
        select: expect.objectContaining({
          provider: {
            select: {
              name: true,
              owner: { select: { displayName: true, npub: true } },
            },
          },
        }),
      }),
    );
  });
});
