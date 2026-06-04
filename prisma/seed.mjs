import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Identidad Nostr de relleno para el proveedor demo (solo display en dev).
const OWNER_PUBKEY =
  "1111111111111111111111111111111111111111111111111111111111111111";

const GAMES = [
  {
    slug: "orbital-clicker",
    title: "Orbital Clicker",
    description:
      "Un clicker idle en el espacio. Acumulá energía orbital y desbloqueá estaciones. Gratis para empezar.",
    category: "arcade",
    priceSats: 0,
  },
  {
    slug: "cripto-tetris",
    title: "Cripto Tetris",
    description:
      "El clásico de bloques con un giro: cada línea completada suma sats a tu puntaje.",
    category: "puzzle",
    priceSats: 5,
  },
  {
    slug: "luna-runner",
    title: "Luna Runner",
    description:
      "Endless runner por la superficie lunar. Esquivá cráteres y batí tu récord.",
    category: "arcade",
    priceSats: 10,
  },
];

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

  const gameUrl = "/demo-game/index.html"; // todos apuntan al juego demo
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
