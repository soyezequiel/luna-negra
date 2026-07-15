import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { sub: "me", npub: "npub-me", pubkey: "pk-me" } as {
    sub: string;
    npub: string;
    pubkey: string;
  } | null,
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
    },
  },
}));

async function search(q: string) {
  const { GET } = await import("@/app/api/users/search/route");
  const response = await GET(
    new Request(`https://luna.example/api/users/search?q=${encodeURIComponent(q)}`),
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  mocks.session = { sub: "me", npub: "npub-me", pubkey: "pk-me" };
  mocks.findUnique.mockReset().mockResolvedValue(null);
  mocks.findMany.mockReset().mockResolvedValue([]);
});

describe("GET /api/users/search", () => {
  it("busca nombres sin distinguir mayúsculas y devuelve avatar y código", async () => {
    mocks.findMany.mockResolvedValue([
      {
        pubkey: "pk-ana",
        npub: "npub-ana",
        displayName: "Ana Luna",
        avatarUrl: "https://img.example/ana.png",
        friendCode: 4217,
      },
    ]);

    const result = await search("aNa");

    expect(result.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        displayName: { contains: "aNa", mode: "insensitive" },
        pubkey: { not: "pk-me" },
      },
    }));
    expect(result.body.users[0]).toMatchObject({
      displayName: "Ana Luna",
      avatarUrl: "https://img.example/ana.png",
      friendCode: 4217,
      isMember: true,
    });
  });

  it("prioriza una coincidencia exacta por código y no devuelve al usuario actual", async () => {
    mocks.findUnique.mockResolvedValue({
      pubkey: "pk-code",
      npub: "npub-code",
      displayName: "Código",
      avatarUrl: null,
      friendCode: 7,
    });

    const result = await search("7");

    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { friendCode: 7 },
    }));
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(result.body.users).toHaveLength(1);
    expect(result.body.users[0].friendCode).toBe(7);

    mocks.findUnique.mockResolvedValue({
      pubkey: "pk-me",
      npub: "npub-me",
      displayName: "Yo",
      avatarUrl: null,
      friendCode: 7,
    });
    expect((await search("7")).body.users).toEqual([]);
  });

  it("requiere sesión", async () => {
    mocks.session = null;
    expect((await search("Ana")).status).toBe(401);
  });
});
