import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
    provider = await prisma.provider.create({
      data: {
        ownerId: owner.id,
        name: "Estudio Demo",
        status: "approved",
        lightningAddress: "demo@getalby.com", // placeholder (payout real en prod)
      },
    });
  }

  const gameUrl = "/demo-game/index.html"; // relleno por si se reactivan juegos demo
  for (const g of GAMES) {
    await prisma.game.upsert({
      where: { slug: g.slug },
      update: { ...g, providerId: provider.id, status: "published", gameUrl },
      create: { ...g, providerId: provider.id, status: "published", gameUrl },
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
