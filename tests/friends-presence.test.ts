import { describe, expect, it } from "vitest";
import {
  applyFreshStatuses,
  applyOnlineInStore,
  dropExpiredStatuses,
  stripStorePresence,
  type Friend,
} from "@/hooks/use-friends";
import {
  selectFreshStatuses,
  STATUS_FALLBACK_TTL_SECONDS,
} from "@/lib/nostr-social";

function friend(pubkey: string, expiresAt = 9_999_999_999): Friend {
  return {
    pubkey,
    npub: `npub-${pubkey}`,
    isMember: true,
    games: [],
    lastPlayedAt: null,
    status: { content: "Jugando Tetris (Beta) en Luna Negra", expiresAt },
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
  it("persists the NIP-38 status so it paints instantly after a refresh", () => {
    const [cached] = stripStorePresence([friend("a")]);

    expect(cached.status?.content).toContain("Tetris");
  });

  it("does not persist volatile store presence in the friends cache", () => {
    const [cached] = stripStorePresence([
      { ...friend("a"), onlineInStore: true },
    ]);

    expect(cached.onlineInStore).toBeUndefined();
  });

  it("drops a persisted status once its expiration has passed", () => {
    const nowSec = 1_000;
    const [dropped] = dropExpiredStatuses([friend("a", nowSec - 1)], nowSec);

    expect(dropped.status).toBeUndefined();
  });

  it("keeps a persisted status that has not expired yet", () => {
    const nowSec = 1_000;
    const list = [friend("a", nowSec + 60)];
    const kept = dropExpiredStatuses(list, nowSec);

    expect(kept[0].status?.content).toContain("Tetris");
    // Misma referencia: no re-renderiza si no venció nada.
    expect(kept).toBe(list);
  });

  it("clears old status when the fresh status result has no entry", () => {
    const [updated] = applyFreshStatuses([friend("a")], {});

    expect(updated.status).toBeUndefined();
  });
});

describe("store presence (web abierta)", () => {
  it("marks online only the friends in the set", () => {
    const [a, b] = applyOnlineInStore(
      [friend("a"), friend("b")],
      new Set(["a"]),
    );

    expect(a.onlineInStore).toBe(true);
    expect(b.onlineInStore).toBe(false);
  });

  it("clears store presence when the friend drops out of the set", () => {
    const [updated] = applyOnlineInStore(
      [{ ...friend("a"), onlineInStore: true }],
      new Set<string>(),
    );

    expect(updated.onlineInStore).toBe(false);
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

  it("accepts coord-anchored NGP presence signed by the game (no luna-negra label)", () => {
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
});

describe("NIP-38 clear override (kept)", () => {
  const now = 1_000;

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
