import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Bóveda de secretos: cifra material sensible (ej. la clave Nostr del oráculo
// gestionado por proveedor) ANTES de guardarlo en la DB. Cifrado autenticado
// AES-256-GCM con una clave maestra de entorno. El texto plano nunca se loguea
// ni se devuelve por la API.
//
// Formato del blob: `v1:<ivB64url>:<tagB64url>:<ctB64url>`.
// El prefijo de versión permite rotar el algoritmo/clave maestra en el futuro.

const VERSION = "v1";

/**
 * Clave maestra de 32 bytes desde `ORACLE_ENC_KEY` (hex de 64 chars o base64).
 * Se resuelve perezosamente para no romper en build/edge donde no se usa.
 */
function masterKey(): Buffer {
  const raw = process.env.ORACLE_ENC_KEY;
  if (!raw) {
    throw new Error(
      "ORACLE_ENC_KEY no configurada (32 bytes en hex o base64) — requerida para cifrar la clave del oráculo",
    );
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== 32) {
    throw new Error("ORACLE_ENC_KEY debe decodificar a exactamente 32 bytes");
  }
  return key;
}

/** Cifra bytes en claro y devuelve el blob versionado (texto para la DB). */
export function encryptSecret(plain: Uint8Array): string {
  const iv = randomBytes(12); // GCM: nonce de 96 bits
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
}

/** Descifra un blob producido por `encryptSecret`. Lanza si fue alterado. */
export function decryptSecret(blob: string): Uint8Array {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Blob cifrado con formato inválido");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(plain);
}
