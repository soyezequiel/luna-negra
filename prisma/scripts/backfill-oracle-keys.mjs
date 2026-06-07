// Backfill de claves de oráculo para proveedores existentes.
//
// Genera una clave Nostr gestionada (keypair) por cada proveedor que aún no la
// tenga, cifra el secreto con ORACLE_ENC_KEY (AES-256-GCM, mismo formato que
// src/lib/crypto-vault.ts) y persiste oraclePubkey + oracleSecretEnc.
//
// Idempotente: salta los proveedores que ya tienen clave.
//
// Uso:  ORACLE_ENC_KEY=<32 bytes hex/base64> node prisma/scripts/backfill-oracle-keys.mjs
import { PrismaClient } from "@prisma/client";
import { createCipheriv, randomBytes } from "node:crypto";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

const prisma = new PrismaClient();

function masterKey() {
  const raw = process.env.ORACLE_ENC_KEY;
  if (!raw) throw new Error("ORACLE_ENC_KEY no configurada");
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ORACLE_ENC_KEY debe ser 32 bytes");
  return key;
}

function encryptSecret(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
}

async function main() {
  const providers = await prisma.provider.findMany({
    where: { OR: [{ oraclePubkey: null }, { oracleSecretEnc: null }] },
    select: { id: true, name: true },
  });
  console.log(`Proveedores a provisionar: ${providers.length}`);
  for (const p of providers) {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    await prisma.provider.update({
      where: { id: p.id },
      data: { oraclePubkey: pubkey, oracleSecretEnc: encryptSecret(sk) },
    });
    console.log(`  ✓ ${p.name} (${p.id}) → oraclePubkey=${pubkey.slice(0, 12)}…`);
  }
  console.log("Backfill OK.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
