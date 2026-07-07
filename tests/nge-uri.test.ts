import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, finalizeEvent, type Event } from "nostr-tools/pure";
import { buildNgeUri, buildBindTemplate, bindDTag } from "@/lib/nge-uri";
import { NGE, parseNgeUri, type NgeTransport } from "../sdk/nge";

// El emisor (src/lib/nge-uri.ts) y el consumidor (sdk/nge.ts) deben encajar: la URI
// que arma Luna la parsea el SDK, y el bind que publica lo resuelve binding().

function fakeTransport(seed: Event[]): NgeTransport {
  return {
    async publish() {},
    async query(f) {
      const filter = f as Record<string, unknown>;
      return seed.filter((e) => {
        if (Array.isArray(filter.kinds) && !filter.kinds.includes(e.kind)) return false;
        if (Array.isArray(filter.authors) && !filter.authors.includes(e.pubkey)) return false;
        for (const [k, vals] of Object.entries(filter)) {
          if (!k.startsWith("#") || !Array.isArray(vals)) continue;
          const name = k.slice(1);
          if (!e.tags.some((t) => t[0] === name && (vals as string[]).includes(t[1]))) return false;
        }
        return true;
      });
    },
    subscribe() {
      return () => {};
    },
    close() {},
  };
}

const escrowSk = generateSecretKey();
const escrowPubkey = getPublicKey(escrowSk);
const serviceSk = generateSecretKey();
const servicePubkey = getPublicKey(serviceSk);
const relays = ["wss://relay.uno", "wss://relay.dos"];
const gameCoord = `30023:${getPublicKey(generateSecretKey())}:pac`;

describe("buildNgeUri ↔ parseNgeUri", () => {
  it("la URI del emisor la parsea el SDK y deriva el mismo oráculo", () => {
    const uri = buildNgeUri({ escrowPubkey, relays, serviceSecret: serviceSk });
    expect(uri.startsWith("nostr+nge://")).toBe(true);
    const conn = parseNgeUri(uri);
    expect(conn.escrowPubkey).toBe(escrowPubkey);
    expect(conn.relays).toEqual(relays);
    expect(conn.oraclePubkey).toBe(servicePubkey);
  });
});

describe("buildBindTemplate ↔ NGE.binding()", () => {
  it("el bind publicado por el emisor lo resuelve el SDK", async () => {
    const tmpl = buildBindTemplate({
      servicePubkey,
      gameCoord,
      lud16: "luna@luna.fit",
      minStakeSats: 100,
      maxStakeSats: 100000,
      feePct: 2,
      devFeePct: 1,
    });
    expect(tmpl.tags).toContainEqual(["d", bindDTag(servicePubkey)]);
    expect(tmpl.tags).toContainEqual(["t", "nge"]);
    expect(tmpl.tags).toContainEqual(["t", "ngp-bet"]); // alias legacy

    const bindEvent = finalizeEvent(
      { kind: tmpl.kind, created_at: Math.floor(Date.now() / 1000), tags: tmpl.tags, content: tmpl.content },
      escrowSk,
    );
    const uri = buildNgeUri({ escrowPubkey, relays, serviceSecret: serviceSk });
    const nge = NGE.connect(uri, { transport: fakeTransport([bindEvent]) });
    const b = await nge.binding();
    expect(b.gameCoord).toBe(gameCoord);
    expect(b.lud16).toBe("luna@luna.fit");
    expect(b.minStakeSats).toBe(100);
    expect(b.maxStakeSats).toBe(100000);
  });
});
