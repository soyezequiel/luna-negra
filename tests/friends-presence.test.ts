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
    lastPlayedAt: null,
    status: { content: "Jugando Tetris (Beta) en Luna Negra" },
  };
}

// La marca "l":"luna-negra" la añade Luna Negra al publicar; los tests la
// incluyen por defecto salvo que se pasen `tags` propios (p. ej. para simular
// una presencia ajena sin la marca).
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
    tags: input.tags ?? [
      ["d", "general"],
      ["l", "luna-negra"],
    ],
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
            ["l", "luna-negra"],
            ["expiration", String(now)],
          ],
        }),
      ],
      now,
    );

    expect(result.a).toBeUndefined();
  });

  it("ignores a general status not published from Luna Negra", () => {
    const result = selectFreshStatuses(
      [
        statusEvent({
          pubkey: "a",
          createdAt: now - 1,
          content: "Accounts",
          tags: [["d", "general"]],
        }),
      ],
      now,
    );

    expect(result.a).toBeUndefined();
  });

  const STORE_PK = "ed13c471be6bff9195a6261d8cbd6c7ab6efe79a7947b208d2b6f066b99cc4d3";

  it("accepts coord-anchored 2.0 presence signed by the game (no luna-negra label)", () => {
    const result = selectFreshStatuses(
      [
        statusEvent({
          pubkey: "a",
          createdAt: now - 1,
          content: "Jugando TETRA",
          tags: [
            ["d", "general"],
            ["a", `30023:${STORE_PK}:tetra-tetris-copia`],
            ["expiration", String(now + 60)],
          ],
        }),
      ],
      now,
      STORE_PK,
    );

    expect(result.a?.content).toBe("Jugando TETRA");
  });

  it("ignores coord-anchored presence whose coord is NOT signed by this store", () => {
    const result = selectFreshStatuses(
      [
        statusEvent({
          pubkey: "a",
          createdAt: now - 1,
          content: "Jugando OtraTienda",
          tags: [
            ["d", "general"],
            ["a", "30023:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef:otro"],
            ["expiration", String(now + 60)],
          ],
        }),
      ],
      now,
      STORE_PK,
    );

    expect(result.a).toBeUndefined();
  });

  it("without a store pubkey, coord-anchored presence is not recognized", () => {
    const result = selectFreshStatuses(
      [
        statusEvent({
          pubkey: "a",
          createdAt: now - 1,
          content: "Jugando TETRA",
          tags: [
            ["d", "general"],
            ["a", `30023:${STORE_PK}:tetra-tetris-copia`],
            ["expiration", String(now + 60)],
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
            ["l", "luna-negra"],
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
