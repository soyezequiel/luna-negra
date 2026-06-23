import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: {
    sub: "provider-owner",
    npub: "npub-provider",
    pubkey: "provider-pubkey",
  } as { sub: string; npub: string; pubkey: string } | null,
  providerFindFirst: vi.fn(),
  gameCreate: vi.fn(),
  gameUpdate: vi.fn(),
  ownedGame: vi.fn(),
  uniqueGameSlug: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    provider: {
      findFirst: mocks.providerFindFirst,
    },
    game: {
      create: mocks.gameCreate,
      update: mocks.gameUpdate,
    },
    platformSettings: {
      findUnique: vi.fn(async () => null),
    },
  },
}));

vi.mock("@/lib/provider", () => ({
  ownedGame: mocks.ownedGame,
}));

vi.mock("@/lib/slug", () => ({
  uniqueGameSlug: mocks.uniqueGameSlug,
}));

// El PATCH refresca el caché del catálogo con revalidateTag, que requiere el
// store de generación estática de Next (ausente en un test unitario). Lo
// stubbeamos: lo que se prueba es la persistencia de la ficha, no el caché.
vi.mock("@/lib/store-catalog", () => ({
  revalidateCatalog: vi.fn(),
}));

async function postProviderGame(body: unknown) {
  const { POST } = await import("@/app/api/provider/games/route");
  const res = await POST(
    new Request("https://luna.example/api/provider/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
}

async function patchProviderGame(body: unknown) {
  const { PATCH } = await import("@/app/api/provider/games/[id]/route");
  const res = await PATCH(
    new Request("https://luna.example/api/provider/games/game-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "game-1" }) },
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  mocks.session = {
    sub: "provider-owner",
    npub: "npub-provider",
    pubkey: "provider-pubkey",
  };
  mocks.providerFindFirst.mockReset().mockResolvedValue({ id: "provider-1" });
  mocks.gameCreate.mockReset().mockResolvedValue({ id: "game-1" });
  mocks.gameUpdate.mockReset().mockResolvedValue({ id: "game-1" });
  mocks.ownedGame.mockReset().mockResolvedValue(true);
  mocks.uniqueGameSlug.mockReset().mockResolvedValue("test-game");
});

describe("provider game media routes", () => {
  it("stores horizontalCoverUrl when creating a game", async () => {
    const result = await postProviderGame({
      title: "Test Game",
      coverUrl: " https://cdn.example/vertical.jpg ",
      horizontalCoverUrl: " https://cdn.example/horizontal.jpg ",
      screenshots: ["shot.png"],
    });

    expect(result.status).toBe(200);
    expect(mocks.gameCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        coverUrl: "https://cdn.example/vertical.jpg",
        horizontalCoverUrl: "https://cdn.example/horizontal.jpg",
        revenueShare: 70,
        screenshots: JSON.stringify(["shot.png"]),
      }),
    });
  });

  it("stores horizontalCoverUrl when editing a game", async () => {
    const result = await patchProviderGame({
      horizontalCoverUrl: " https://cdn.example/new-horizontal.jpg ",
    });

    expect(result.status).toBe(200);
    expect(mocks.gameUpdate).toHaveBeenCalledWith({
      where: { id: "game-1" },
      data: { horizontalCoverUrl: "https://cdn.example/new-horizontal.jpg" },
    });
  });
});
