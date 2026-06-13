import { beforeEach, describe, expect, it, vi } from "vitest";

// Estado en memoria que simula las dos tablas (RoomState compartido + roster).
const store = vi.hoisted(() => ({
  invite: null as { npub: string; roomId: string } | null,
  shared: new Map<string, { dataJson: string; version: number; expiresAt: Date }>(),
  members: new Map<string, { roomId: string; npub: string; stateJson: string; createdAt: number; expiresAt: Date }>(),
  users: [] as Array<{ npub: string; displayName: string | null; avatarUrl: string | null }>,
}));

vi.mock("@/lib/auth", () => ({
  verifyInvite: vi.fn(async (token: string) => (token && store.invite ? store.invite : null)),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    roomState: {
      findUnique: vi.fn(async ({ where: { roomId } }: any) => store.shared.get(roomId) ?? null),
      upsert: vi.fn(async ({ where: { roomId }, create, update }: any) => {
        const existing = store.shared.get(roomId);
        const row = existing ? { ...existing, ...update } : { ...create };
        store.shared.set(roomId, row);
        return row;
      }),
      updateMany: vi.fn(async ({ where: { roomId }, data }: any) => {
        const existing = store.shared.get(roomId);
        if (existing) store.shared.set(roomId, { ...existing, ...data });
        return { count: existing ? 1 : 0 };
      }),
      deleteMany: vi.fn(async ({ where: { roomId, expiresAt } }: any) => {
        const row = store.shared.get(roomId);
        if (row && expiresAt?.lt && row.expiresAt < expiresAt.lt) store.shared.delete(roomId);
        return { count: 0 };
      }),
    },
    roomMemberState: {
      findMany: vi.fn(async ({ where: { roomId, expiresAt } }: any) => {
        return [...store.members.values()]
          .filter((m) => m.roomId === roomId && (!expiresAt?.gte || m.expiresAt >= expiresAt.gte))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((m) => ({ npub: m.npub, stateJson: m.stateJson }));
      }),
      upsert: vi.fn(async ({ where: { roomId_npub }, create, update }: any) => {
        const key = `${roomId_npub.roomId}:${roomId_npub.npub}`;
        const existing = store.members.get(key);
        if (existing) store.members.set(key, { ...existing, ...update });
        else store.members.set(key, { roomId: roomId_npub.roomId, npub: roomId_npub.npub, createdAt: Date.now(), ...create });
        return store.members.get(key);
      }),
      deleteMany: vi.fn(async ({ where: { roomId, expiresAt } }: any) => {
        for (const [key, m] of store.members) {
          if (m.roomId === roomId && expiresAt?.lt && m.expiresAt < expiresAt.lt) store.members.delete(key);
        }
        return { count: 0 };
      }),
    },
    user: {
      findMany: vi.fn(async ({ where: { npub } }: any) => store.users.filter((u) => npub.in.includes(u.npub))),
    },
  },
}));

const ROOM = "ROOM1";

async function post(body: unknown, token = "invite-tok", headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/v1/rooms/[roomId]/state/route");
  const res = await POST(
    new Request(`http://local/api/v1/rooms/${ROOM}/state`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ roomId: ROOM }) },
  );
  return { res, status: res.status, json: res.status === 304 ? null : await res.json() };
}

async function get(token = "invite-tok", headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/v1/rooms/[roomId]/state/route");
  const res = await GET(
    new Request(`http://local/api/v1/rooms/${ROOM}/state`, {
      headers: { authorization: `Bearer ${token}`, ...headers },
    }),
    { params: Promise.resolve({ roomId: ROOM }) },
  );
  return { res, status: res.status, json: res.status === 304 ? null : await res.json() };
}

beforeEach(() => {
  store.invite = { npub: "npub-host", roomId: ROOM };
  store.shared.clear();
  store.members.clear();
  store.users = [{ npub: "npub-host", displayName: "Host", avatarUrl: "http://a/h.png" }];
});

describe("auth", () => {
  it("rejects a token that is not for this room", async () => {
    store.invite = { npub: "npub-host", roomId: "OTHER" };
    const { status, json } = await get();
    expect(status).toBe(401);
    expect(json.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects a missing token", async () => {
    const { status, json } = await get("");
    expect(status).toBe(401);
    expect(json.error.code).toBe("INVALID_TOKEN");
  });
});

describe("shared state", () => {
  it("merges the shared bag last-write-wins per key and bumps version", async () => {
    const first = await post({ set: { turn: "x", board: [1] } });
    expect(first.status).toBe(200);
    expect(first.json.data).toEqual({ turn: "x", board: [1] });
    expect(first.json.version).toBe(1);

    const second = await post({ set: { turn: "o" } });
    expect(second.json.data).toEqual({ turn: "o", board: [1] });
    expect(second.json.version).toBe(2);
  });

  it("rejects a non-object set", async () => {
    const { status, json } = await post({ set: [1, 2, 3] });
    expect(status).toBe(400);
    expect(json.error.code).toBe("INVALID_SET");
  });

  it("enforces optimistic concurrency when version is provided", async () => {
    await post({ set: { a: 1 } }); // version → 1
    const conflict = await post({ set: { a: 2 }, version: 0 });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe("VERSION_CONFLICT");

    const ok = await post({ set: { a: 2 }, version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.json.version).toBe(2);
  });

  it("rejects a shared bag over 8KB", async () => {
    const { status, json } = await post({ set: { big: "x".repeat(9000) } });
    expect(status).toBe(400);
    expect(json.error.code).toBe("STATE_TOO_LARGE");
  });
});

describe("member state", () => {
  it("adds the caller to members with their self bag and cached profile", async () => {
    const { json } = await post({ self: { ready: true } });
    expect(json.members).toEqual([
      { npub: "npub-host", name: "Host", avatar: "http://a/h.png", state: { ready: true } },
    ]);
  });

  it("a plain POST acts as a heartbeat (joins roster with empty state)", async () => {
    const { json } = await post({});
    expect(json.members).toEqual([
      { npub: "npub-host", name: "Host", avatar: "http://a/h.png", state: {} },
    ]);
  });

  it("rejects a self bag over 2KB", async () => {
    const { status, json } = await post({ self: { big: "x".repeat(2100) } });
    expect(status).toBe(400);
    expect(json.error.code).toBe("STATE_TOO_LARGE");
  });

  it("lists multiple members ordered by arrival", async () => {
    store.invite = { npub: "npub-host", roomId: ROOM };
    await post({ self: { ready: true } });
    store.invite = { npub: "npub-guest", roomId: ROOM };
    store.users.push({ npub: "npub-guest", displayName: "Guest", avatarUrl: null });
    await post({ self: { ready: false } });

    const { json } = await get();
    expect(json.members.map((m: any) => m.npub)).toEqual(["npub-host", "npub-guest"]);
  });
});

describe("cheap polling", () => {
  it("returns 304 when the ETag matches and 200 after a change", async () => {
    await post({ set: { turn: "x" } });
    const first = await get();
    const etag = first.res.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(first.res.headers.get("cache-control")).toBe("no-store");

    const cached = await get("invite-tok", { "if-none-match": etag! });
    expect(cached.status).toBe(304);

    await post({ set: { turn: "o" } });
    const changed = await get("invite-tok", { "if-none-match": etag! });
    expect(changed.status).toBe(200);
    expect(changed.json.data).toEqual({ turn: "o" });
  });
});
