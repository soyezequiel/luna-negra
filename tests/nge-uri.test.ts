import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { buildNgeUri } from "@/lib/nge-uri";
import { parseNgeUri } from "../sdk/nge-core";

// NGE v2: el emisor (Luna, src/lib/nge-uri.ts) arma la URI y el consumidor
// (sdk/nge-core.ts, el juego) la parsea. Deben encajar byte a byte. Ya no hay `bind`
// event ni oráculo declarado: la URI es TODA la credencial (§4 de la spec).
const V = JSON.parse(
  readFileSync(new URL("../docs/nge/test-vectors.json", import.meta.url), "utf8"),
) as {
  uri: string;
  parsed: { escrowPubkey: string; relays: string[]; clientPubkey: string };
  keys: { escrow: { pubkey: string }; client: { sk: string; nsec: string } };
};

const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

describe("buildNgeUri ↔ parseNgeUri", () => {
  it("reproduce EXACTAMENTE la URI del vector", () => {
    const uri = buildNgeUri({
      escrowPubkey: V.keys.escrow.pubkey,
      relays: V.parsed.relays,
      serviceSecret: hexToBytes(V.keys.client.sk),
    });
    expect(uri).toBe(V.uri);
  });

  it("la URI del emisor la parsea el SDK y deriva los mismos campos", () => {
    const escrowPubkey = getPublicKey(generateSecretKey());
    const secret = generateSecretKey();
    const relays = ["wss://relay.uno", "wss://relay.dos"];
    const uri = buildNgeUri({ escrowPubkey, relays, serviceSecret: secret });

    expect(uri.startsWith("nostr+nge://")).toBe(true);
    const conn = parseNgeUri(uri);
    expect(conn.escrowPubkey).toBe(escrowPubkey);
    expect(conn.relays).toEqual(relays);
    // el escrow autentica al juego por esta pubkey derivada del `secret`
    expect(conn.clientPubkey).toBe(getPublicKey(secret));
  });

  it("el `secret` viaja como nsec (bech32), nunca como hex crudo", () => {
    const uri = buildNgeUri({
      escrowPubkey: V.keys.escrow.pubkey,
      relays: V.parsed.relays,
      serviceSecret: hexToBytes(V.keys.client.sk),
    });
    expect(new URL(uri).searchParams.get("secret")).toBe(V.keys.client.nsec);
  });
});
