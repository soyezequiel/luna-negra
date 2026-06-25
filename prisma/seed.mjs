import { PrismaClient } from "@prisma/client";
import { createCipheriv, randomBytes } from "node:crypto";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

const prisma = new PrismaClient();

// Genera una clave de oráculo gestionada (igual que src/lib/oracle-keys.ts).
// Si no hay ORACLE_ENC_KEY (dev), deja la clave sin provisionar (null).
function oracleKey() {
  const raw = process.env.ORACLE_ENC_KEY;
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) return null;
  const sk = generateSecretKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(sk)), cipher.final()]);
  const tag = cipher.getAuthTag();
  const enc = [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
  return { pubkey: getPublicKey(sk), secretEnc: enc };
}

// Identidad Nostr de relleno para el proveedor demo (solo display en dev).
const OWNER_PUBKEY =
  "1111111111111111111111111111111111111111111111111111111111111111";

// Sin juegos de relleno: el catálogo lo cargan los proveedores reales.
const GAMES = [];

async function main() {
  const owner = await prisma.user.upsert({
    where: { pubkey: OWNER_PUBKEY },
    update: {},
    create: {
      pubkey: OWNER_PUBKEY,
      npub: "npub1lunanegraseed",
      displayName: "Estudio Demo",
    },
  });

  let provider = await prisma.provider.findFirst({
    where: { ownerId: owner.id },
  });
  if (!provider) {
    const ok = oracleKey();
    provider = await prisma.provider.create({
      data: {
        ownerId: owner.id,
        name: "Estudio Demo",
        status: "approved",
        lightningAddress: "demo@getalby.com", // placeholder (payout real en prod)
        ...(ok ? { oraclePubkey: ok.pubkey, oracleSecretEnc: ok.secretEnc } : {}),
      },
    });
  }

  for (const g of GAMES) {
    await prisma.game.upsert({
      where: { slug: g.slug },
      update: { ...g, providerId: provider.id, status: "published" },
      create: { ...g, providerId: provider.id, status: "published" },
    });
  }

  console.log(`Seed OK: ${GAMES.length} juegos publicados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
