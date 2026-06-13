import { beforeEach, describe, expect, it, vi } from "vitest";

// Estado en memoria que simula las tablas Room + RoomPresence + User.
type PresenceRow = {
  roomId: string;
  clientId: string;
  npub: string;
  host: boolean;
  score: number;
  createdAt: number;
  updatedAt: Date;
};
type RoomRow = {
  id: string;
  gameId: string;
  roomId: string;
  hostSeenAt: Date | null;
  closedAt: Date | null;
};

const store = vi.hoisted(() => ({
  invite: null as {
    npub: string;
    pubkey: string;
    gameId: string;
    slug: string;
    roomId: string;
    host: boolean;
    hostNpub: string | null;
    hostPubkey: string | null;
  } | null,
  room: null as RoomRow | null,
  presence: new Map<string, PresenceRow>(),
  users: [] as Array<{ npub: string; pubkey: string; displayName: string | null; avatarUrl: string | null }>,
}));

vi.mock("@/lib/auth", () => ({
  verifyInvite: vi.fn(async (token: string) => (token && store.invite ? store.invite : null)),
  signInvite: vi.fn(async () => "signed-token"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findUnique: vi.fn(async ({ where: { gameId_roomId } }: any) =>
        store.room &&
        store.room.gameId === gameId_roomId.gameId &&
        store.room.roomId === gameId_roomId.roomId
          ? store.room
          : null,
      ),
      update: vi.fn(async ({ where: { id }, data }: any) => {
        if (store.room && store.room.id === id) Object.assign(store.room, data);
        return store.room;
      }),
    },
    roomPresence: {
      delete: vi.fn(async ({ where: { roomId_clientId } }: any) => {
        store.presence.delete(`${roomId_clientId.roomId}:${roomId_clientId.clientId}`);
        return {};
      }),
      upsert: vi.fn(async ({ where: { roomId_clientId }, create, update }: any) => {
        const key = `${roomId_clientId.roomId}:${roomId_clientId.clientId}`;
        const existing = store.presence.get(key);
        if (existing) store.presence.set(key, { ...existing, ...update, updatedAt: new Date() });
        else
          store.presence.set(key, {
            roomId: roomId_clientId.roomId,
            clientId: roomId_clientId.clientId,
            createdAt: Date.now(),
            updatedAt: new Date(),
            ...create,
          });
        return store.presence.get(key);
      }),
      deleteMany: vi.fn(async ({ where: { roomId, updatedAt } }: any) => {
        for (const [key, row] of store.presence) {
          if (row.roomId !== roomId) continue;
          if (!updatedAt) store.presence.delete(key); // borrar todas las de la sala
          else if (updatedAt.lt && row.updatedAt < updatedAt.lt) store.presence.delete(key);
        }
        return { count: 0 };
      }),
      findMany: vi.fn(async ({ where: { roomId, updatedAt } }: any) =>
        [...store.presence.values()]
          .filter((r) => r.roomId === roomId && (!updatedAt?.gte || r.updatedAt >= updatedAt.gte))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((r) => ({ clientId: r.clientId, npub: r.npub, host: r.host, score: r.score })),
      ),
    },
    user: {
      findMany: vi.fn(async ({ where: { npub } }: any) =>
        store.users.filter((u) => npub.in.includes(u.npub)),
      ),
    },
  },
}));

const ROOM = "ROOM1";

function hostInvite() {
  return {
    npub: "npub-host",
    pubkey: "pk-host",
    gameId: "g1",
    slug: "tetris",
    roomId: ROOM,
    host: true,
    hostNpub: "npub-host",
    hostPubkey: "pk-host",
  };
}

function addGuest() {
  store.presence.set(`${ROOM}:guest-1`, {
    roomId: ROOM,
    clientId: "guest-1",
    npub: "npub-guest",
    host: false,
    score: 0,
    createdAt: Date.now(),
    updatedAt: new Date(),
  });
  store.users.push({ npub: "npub-guest", pubkey: "pk-guest", displayName: "Guest", avatarUrl: null });
}

beforeEach(() => {
  store.invite = hostInvite();
  store.room = { id: "r1", gameId: "g1", roomId: ROOM, hostSeenAt: null, closedAt: null };
  store.presence.clear();
  store.users = [
    { npub: "npub-host", pubkey: "pk-host", displayName: "Host", avatarUrl: "http://a/h.png" },
  ];
});

async function call(input: Record<string, unknown>) {
  const { resolvePresence } = await import("@/lib/rooms");
  return resolvePresence(ROOM, { inviteToken: "t", clientId: undefined, score: 0, leave: false, ...input });
}

describe("resolvePresence peek mode", () => {
  it("peek with the host token reads the roster WITHOUT closing the room", async () => {
    addGuest();

    const result = await call({ peek: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closed).toBe(false);
    expect(result.members.map((m) => m.npub)).toEqual(["npub-guest"]);
    // El bug original: el peek (leave:true + token host) cerraba la sala aquí.
    expect(store.room?.closedAt).toBeNull();
  });

  it("peek does not register the caller in the roster", async () => {
    const result = await call({ peek: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members).toEqual([]);
    expect(store.presence.size).toBe(0);
  });

  it("peek on an already-closed room reports closed", async () => {
    store.room!.closedAt = new Date();

    const result = await call({ peek: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closed).toBe(true);
    expect(result.members).toEqual([]);
  });
});

describe("resolvePresence host close (intended behavior preserved)", () => {
  it("a real host leave closes the room and evicts everyone", async () => {
    addGuest();

    const result = await call({ clientId: "host-1", leave: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closed).toBe(true);
    expect(store.room?.closedAt).not.toBeNull();
    expect(store.presence.size).toBe(0);
  });

  it("a normal host heartbeat seals hostSeenAt and keeps the room open", async () => {
    const result = await call({ clientId: "host-1", leave: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closed).toBe(false);
    expect(store.room?.hostSeenAt).not.toBeNull();
    expect(store.room?.closedAt).toBeNull();
  });
});
