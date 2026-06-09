import { describe, expect, it } from "vitest";
import {
  applyFreshStatuses,
  stripVolatileStatuses,
  type Friend,
} from "@/hooks/use-friends";
import {
  selectFreshStatuses,
  STATUS_FALLBACK_TTL_SECONDS,
} from "@/lib/nostr-social";

function friend(pubkey: string): Friend {
  return {
    pubkey,
    npub: `npub-${pubkey}`,
    isMember: true,
    games: [],
    status: { content: "Jugando Tetris (Beta) en Luna Negra" },
  };
}

function statusEvent(input: {
  pubkey: string;
  createdAt: number;
  content?: string;
  tags?: string[][];
}) {
  return {
    pubkey: input.pubkey,
    created_at: input.createdAt,
    content: input.content ?? "Jugando Tetris (Beta) en Luna Negra",
    tags: input.tags ?? [["d", "general"]],
  };
}

describe("friend presence cache", () => {
  it("does not persist volatile status in the friends cache", () => {
    const cached = stripVolatileStatuses([friend("a")]);

    expect(cached[0].status).toBeUndefined();
  });

  it("clears old status when the fresh status result has no entry", () => {
    const [updated] = applyFreshStatuses([friend("a")], {});

    expect(updated.status).toBeUndefined();
  });
});

describe("NIP-38 presence freshness", () => {
  const now = 1_000;

  it("keeps a fresh non-expiring status only inside the fallback TTL", () => {
    const result = selectFreshStatuses(
      [
        statusEvent({
          pubkey: "a",
          createdAt: now - STATUS_FALLBACK_TTL_SECONDS + 1,
        }),
      ],
      now,
    );

    expect(result.a?.content).toContain("Tetris");
  });

  it("drops a stale non-expiring status", () => {
    const result = selectFreshStatuses(
      [
        statusEvent({
          pubkey: "a",
          createdAt: now - STATUS_FALLBACK_TTL_SECONDS,
        }),
      ],
      now,
    );

    expect(result.a).toBeUndefined();
  });

  it("drops an expired status even if relays still return it", () => {
    const result = selectFreshStatuses(
      [
        statusEvent({
          pubkey: "a",
          createdAt: now - 1,
          tags: [
            ["d", "general"],
            ["expiration", String(now)],
          ],
        }),
      ],
      now,
    );

    expect(result.a).toBeUndefined();
  });

  it("lets a newer clear event override an older playing event", () => {
    const result = selectFreshStatuses(
      [
        statusEvent({
          pubkey: "a",
          createdAt: now - 2,
          tags: [
            ["d", "general"],
            ["expiration", String(now + 30)],
          ],
        }),
        statusEvent({
          pubkey: "a",
          createdAt: now - 1,
          content: "",
          tags: [
            ["d", "general"],
            ["expiration", String(now + 1)],
          ],
        }),
      ],
      now,
    );

    expect(result.a).toBeUndefined();
  });
});
