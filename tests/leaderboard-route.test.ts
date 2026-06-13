import { beforeEach, describe, expect, it, vi } from "vitest";

// Estado en memoria que simula Leaderboard + Score (best-per-player).
const store = vi.hoisted(() => ({
  ent: null as { npub: string; pubkey: string; gameId: string; slug: string } | null,
  boards: new Map<string, { id: string; gameId: string; name: string }>(), // key gameId:name
  scores: new Map<string, { leaderboardId: string; npub: string; score: number; updatedAt: Date }>(), // key boardId:npub
  users: [] as Array<{ npub: string; displayName: string | null }>,
  seq: 0,
}));

vi.mock("@/lib/auth", () => ({
  verifyEntitlement: vi.fn(async (token: string) => (token ? store.ent : null)),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    leaderboard: {
      upsert: vi.fn(async ({ where: { gameId_name }, create }: any) => {
        const key = `${gameId_name.gameId}:${gameId_name.name}`;
        let row = store.boards.get(key);
        if (!row) {
          row = { id: `board-${++store.seq}`, gameId: create.gameId, name: create.name };
          store.boards.set(key, row);
        }
        return row;
      }),
      findUnique: vi.fn(async ({ where: { gameId_name } }: any) => {
        return store.boards.get(`${gameId_name.gameId}:${gameId_name.name}`) ?? null;
      }),
    },
    score: {
      findUnique: vi.fn(async ({ where: { leaderboardId_npub } }: any) => {
        return store.scores.get(`${leaderboardId_npub.leaderboardId}:${leaderboardId_npub.npub}`) ?? null;
      }),
      upsert: vi.fn(async ({ where: { leaderboardId_npub }, create, update }: any) => {
        const key = `${leaderboardId_npub.leaderboardId}:${leaderboardId_npub.npub}`;
        const existing = store.scores.get(key);
        const row = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : { leaderboardId: leaderboardId_npub.leaderboardId, npub: leaderboardId_npub.npub, updatedAt: new Date(), ...create };
        store.scores.set(key, row);
        return row;
      }),
      count: vi.fn(async ({ where: { leaderboardId, score } }: any) => {
        return [...store.scores.values()].filter(
          (s) => s.leaderboardId === leaderboardId && (!score?.gt ? true : s.score > score.gt),
        ).length;
      }),
      findMany: vi.fn(async ({ where: { leaderboardId, updatedAt }, take }: any) => {
        return [...store.scores.values()]
          .filter((s) => s.leaderboardId === leaderboardId && (!updatedAt?.gte || s.updatedAt >= updatedAt.gte))
          .sort((a, b) => (b.score - a.score) || (a.updatedAt.getTime() - b.updatedAt.getTime()))
          .slice(0, take)
          .map((s) => ({ npub: s.npub, score: s.score }));
      }),
    },
    user: {
      findMany: vi.fn(async ({ where: { npub } }: any) => store.users.filter((u) => npub.in.includes(u.npub))),
    },
  },
}));

async function submit(name: string, body: unknown, token = "ent-tok") {
  const { POST } = await import("@/app/api/v1/leaderboards/[name]/scores/route");
  const res = await POST(
    new Request(`http://local/api/v1/leaderboards/${name}/scores`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ name }) },
  );
  return { status: res.status, json: await res.json() };
}

async function read(name: string, query = "", token = "ent-tok") {
  const { GET } = await import("@/app/api/v1/leaderboards/[name]/route");
  const res = await GET(
    new Request(`http://local/api/v1/leaderboards/${name}${query}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ name }) },
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  store.ent = { npub: "npub-a", pubkey: "a", gameId: "game1", slug: "tetris" };
  store.boards.clear();
  store.scores.clear();
  store.users = [];
  store.seq = 0;
});

describe("auth", () => {
  it("rejects a missing entitlement on submit and read", async () => {
    const s = await submit("clasico", { score: 10 }, "");
    expect(s.status).toBe(401);
    expect(s.json.error.code).toBe("INVALID_TOKEN");
    const r = await read("clasico", "", "");
    expect(r.status).toBe(401);
  });
});

describe("POST scores (se queda el mejor)", () => {
  it("creates the board and records the first score", async () => {
    const { status, json } = await submit("clasico", { score: 100 });
    expect(status).toBe(200);
    expect(json).toEqual({ score: 100, rank: 1, improved: true });
  });

  it("keeps the best score (a lower resubmit does not improve)", async () => {
    await submit("clasico", { score: 100 });
    const lower = await submit("clasico", { score: 40 });
    expect(lower.json).toEqual({ score: 100, rank: 1, improved: false });
    const higher = await submit("clasico", { score: 250 });
    expect(higher.json).toEqual({ score: 250, rank: 1, improved: true });
  });

  it("rejects an invalid score and an invalid name", async () => {
    const bad = await submit("clasico", { score: -5 });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("INVALID_SCORE");
    const badName = await submit("inv@lid name", { score: 5 });
    expect(badName.status).toBe(400);
    expect(badName.json.error.code).toBe("INVALID_NAME");
  });

  it("ranks competitors by score (ties share a rank)", async () => {
    store.ent = { npub: "npub-a", pubkey: "a", gameId: "game1", slug: "t" };
    await submit("clasico", { score: 100 });
    store.ent = { npub: "npub-b", pubkey: "b", gameId: "game1", slug: "t" };
    const b = await submit("clasico", { score: 300 });
    expect(b.json.rank).toBe(1);
    store.ent = { npub: "npub-c", pubkey: "c", gameId: "game1", slug: "t" };
    const c = await submit("clasico", { score: 100 });
    expect(c.json.rank).toBe(2); // 1 jugador con score mayor → puesto 2
  });
});

describe("GET leaderboard", () => {
  beforeEach(async () => {
    for (const [npub, score] of [["npub-a", 100], ["npub-b", 300], ["npub-c", 200]] as const) {
      store.ent = { npub, pubkey: npub, gameId: "game1", slug: "t" };
      await submit("clasico", { score });
    }
    store.users = [
      { npub: "npub-a", displayName: "Ana" },
      { npub: "npub-b", displayName: "Beto" },
      { npub: "npub-c", displayName: null },
    ];
    store.ent = { npub: "npub-a", pubkey: "a", gameId: "game1", slug: "t" };
  });

  it("returns the top ordered by score with ranks and displayName", async () => {
    const { json } = await read("clasico", "?view=top");
    expect(json.entries).toEqual([
      { npub: "npub-b", displayName: "Beto", score: 300, rank: 1 },
      { npub: "npub-c", displayName: null, score: 200, rank: 2 },
      { npub: "npub-a", displayName: "Ana", score: 100, rank: 3 },
    ]);
  });

  it("returns the slice around a player", async () => {
    const { json } = await read("clasico", "?view=around&npub=npub-a");
    expect(json.entries.map((e: any) => e.npub)).toContain("npub-a");
    expect(json.entries.find((e: any) => e.npub === "npub-a").rank).toBe(3);
  });

  it("returns empty entries for an unknown leaderboard", async () => {
    const { json } = await read("inexistente");
    expect(json.entries).toEqual([]);
  });

  it("week window filters out players whose record is older than 7 days", async () => {
    // Envejecemos el récord de npub-a más allá de la ventana.
    const aged = store.scores.get("board-1:npub-a");
    if (aged) aged.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { json } = await read("clasico", "?window=week&view=top");
    expect(json.entries.map((e: any) => e.npub)).toEqual(["npub-b", "npub-c"]);
  });
});
