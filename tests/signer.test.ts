import { describe, expect, it } from "vitest";
import { verifyEvent, nip19, generateSecretKey, getPublicKey } from "nostr-tools";
import {
  createLocalSigner,
  generateLocalSigner,
  importNsec,
} from "@/lib/signer";

describe("createLocalSigner", () => {
  it("firma un kind:1 verificable", async () => {
    const sk = generateSecretKey();
    const signer = createLocalSigner(sk);
    const ev = await signer.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "hola",
    });
    expect(ev.pubkey).toBe(getPublicKey(sk));
    expect(verifyEvent(ev)).toBe(true);
  });

  it("hace roundtrip nip04 entre dos signers locales", async () => {
    const a = createLocalSigner(generateSecretKey());
    const skB = generateSecretKey();
    const b = createLocalSigner(skB);
    const pubB = getPublicKey(skB);
    const pubA = await a.getPublicKey();

    const ciphertext = await a.nip04Encrypt(pubB, "secreto");
    expect(ciphertext).not.toContain("secreto");
    expect(await b.nip04Decrypt(pubA, ciphertext)).toBe("secreto");
  });
});

describe("generateLocalSigner / importNsec", () => {
  it("genera un nsec re-importable con la misma identidad", async () => {
    const { signer, nsec } = generateLocalSigner();
    expect(nsec.startsWith("nsec1")).toBe(true);
    const reimported = importNsec(nsec);
    expect(await reimported.getPublicKey()).toBe(await signer.getPublicKey());
  });

  it("rechaza npub y basura", () => {
    const npub = nip19.npubEncode(getPublicKey(generateSecretKey()));
    expect(() => importNsec(npub)).toThrow(/no es una clave privada/i);
    expect(() => importNsec("hola")).toThrow(/no parece un nsec/i);
  });
});
