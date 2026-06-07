import { describe, it, expect, beforeAll } from "vitest";

// 32 bytes en hex para AES-256.
const KEY = "0".repeat(64);

beforeAll(() => {
  process.env.ORACLE_ENC_KEY = KEY;
});

describe("crypto-vault", () => {
  it("roundtrip: descifra lo que cifró", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/crypto-vault");
    const plain = new Uint8Array([1, 2, 3, 4, 250, 251, 252, 253]);
    const blob = encryptSecret(plain);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob.split(":")).toHaveLength(4);
    expect(new Uint8Array(decryptSecret(blob))).toEqual(plain);
  });

  it("cada cifrado usa un IV distinto (no determinista)", async () => {
    const { encryptSecret } = await import("@/lib/crypto-vault");
    const p = new Uint8Array([9, 9, 9]);
    expect(encryptSecret(p)).not.toBe(encryptSecret(p));
  });

  it("detecta manipulación (auth tag GCM)", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/crypto-vault");
    const blob = encryptSecret(new Uint8Array([1, 2, 3]));
    const parts = blob.split(":");
    // Corromper el ciphertext.
    const tampered = [parts[0], parts[1], parts[2], "AAAA" + parts[3].slice(4)].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rechaza formato inválido", async () => {
    const { decryptSecret } = await import("@/lib/crypto-vault");
    expect(() => decryptSecret("nope")).toThrow();
    expect(() => decryptSecret("v2:a:b:c")).toThrow();
  });
});
