import { beforeEach, describe, expect, it, vi } from "vitest";

// GamePresence en memoria (llaveada por npub), para probar playingPubkeys sin DB.
type PresenceRow = { npub: string; expiresAt: Date };

const store = vi.hoisted(() => ({
  presence: [] as PresenceRow[],
}));

// npubOf determinista para el test: pk -> "npub-<pk>". playingPubkeys mapea
// pubkey -> npub para consultar y npub -> pubkey para responder.
vi.mock("@/lib/nostr-social", () => ({
  npubOf: (pk: string) => `npub-${pk}`,
  clampContacts: (c: string[]) => c,
  fetchContacts: vi.fn(),
  fetchProfiles: vi.fn(),
  profileName: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gamePresence: {
      findMany: vi.fn(async ({ where }: any) => {
        const now = Date.now();
        const set = new Set(where.npub.in as string[]);
        const seen = new Set<string>();
        const out: { npub: string }[] = [];
        for (const r of store.presence) {
          if (!set.has(r.npub)) continue;
          if (r.expiresAt.getTime() <= now) continue; // expiresAt: { gt: now }
          if (seen.has(r.npub)) continue; // distinct: ["npub"]
          seen.add(r.npub);
          out.push({ npub: r.npub });
        }
        return out;
      }),
    },
  },
}));

beforeEach(() => {
  store.presence = [];
});

const fresh = () => new Date(Date.now() + 30_000);
const stale = () => new Date(Date.now() - 1);

describe("playingPubkeys", () => {
  it("returns only pubkeys with a fresh game presence, as pubkeys", async () => {
    store.presence = [
      { npub: "npub-a", expiresAt: fresh() },
      { npub: "npub-b", expiresAt: stale() },
    ];
    const { playingPubkeys } = await import("@/lib/social");

    expect(await playingPubkeys(["a", "b", "c"])).toEqual(["a"]);
  });

  it("collapses multiple presences of the same player (distinct npub)", async () => {
    store.presence = [
      { npub: "npub-a", expiresAt: fresh() },
      { npub: "npub-a", expiresAt: fresh() },
    ];
    const { playingPubkeys } = await import("@/lib/social");

    expect(await playingPubkeys(["a"])).toEqual(["a"]);
  });

  it("returns empty for no pubkeys without hitting the DB", async () => {
    const { playingPubkeys } = await import("@/lib/social");

    expect(await playingPubkeys([])).toEqual([]);
  });
});
