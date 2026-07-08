// Convierte proveedores con oráculo PROPIO (BYO/self-signed) a oráculo GESTIONADO
// por Luna, para que NGE v2 pueda firmar el 1341 interno y pagar el premio. Replica
// revertToManagedOracle (src/lib/oracle-keys.ts): genera keypair, cifra el secreto
// con ORACLE_ENC_KEY (mismo formato AES-256-GCM que src/lib/crypto-vault.ts) y setea
// oraclePubkey + oracleSecretEnc + oracleSelfSigned=false.
//
// A diferencia de backfill-oracle-keys.mjs, este SÍ apaga `oracleSelfSigned` (la flag
// que dispara el rechazo SELF_SIGNED_ORACLE en el escrow NGE v2).
//
// Uso (desde la raíz del proyecto, carga .env):
//   node prisma/scripts/revert-oracle-to-managed.mjs --dry   (solo lista)
//   node prisma/scripts/revert-oracle-to-managed.mjs         (convierte los self-signed)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createCipheriv, randomBytes } from "node:crypto";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

function masterKey() {
  const raw = process.env.ORACLE_ENC_KEY;
  if (!raw) throw new Error("ORACLE_ENC_KEY no configurada (revisá .env)");
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ORACLE_ENC_KEY debe decodificar a 32 bytes");
  return key;
}

function encryptSecret(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

async function main() {
  const all = await prisma.provider.findMany({
    select: { id: true, name: true, oraclePubkey: true, oracleSecretEnc: true, oracleSelfSigned: true },
  });
  console.log(`Proveedores (${all.length}):`);
  for (const p of all) {
    console.log(`  - ${p.name} | pub:${(p.oraclePubkey || "null").slice(0, 10)} | secretEnc:${p.oracleSecretEnc ? "SET" : "NULL"} | selfSigned:${p.oracleSelfSigned}`);
  }

  const targets = all.filter((p) => p.oracleSelfSigned || !p.oracleSecretEnc);
  if (targets.length === 0) {
    console.log("\nNada que convertir: todos tienen oráculo gestionado.");
    return;
  }
  console.log(`\nA convertir a gestionado: ${targets.length}${DRY ? " (DRY, no toco nada)" : ""}`);
  for (const p of targets) {
    if (DRY) {
      console.log(`  · ${p.name} → (dry)`);
      continue;
    }
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    await prisma.provider.update({
      where: { id: p.id },
      data: { oraclePubkey: pubkey, oracleSecretEnc: encryptSecret(sk), oracleSelfSigned: false },
    });
    console.log(`  ✓ ${p.name} → managed oraclePubkey=${pubkey.slice(0, 12)}…`);
  }
  console.log("\nListo. Reintentá el cobro («Reintentar cobro» en la pantalla de resultados).");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
