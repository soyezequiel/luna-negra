import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const game = await prisma.game.findFirst({
  where: { slug: "futbolcillo" },
  select: { id: true, providerId: true, slug: true, nostrCoord: true, status: true, manualCaps: true },
});
console.log("game:", JSON.stringify(game, null, 2));

if (game) {
  const pings = await prisma.integrationPing.findMany({
    where: { gameId: game.id, feature: { startsWith: "ngp:" } },
    orderBy: { lastSeenAt: "desc" },
  });
  console.log("\n=== IntegrationPing ngp:* para este gameId ===");
  for (const p of pings) {
    console.log(
      `  feature=${p.feature} count=${p.count} first=${p.firstSeenAt.toISOString()} last=${p.lastSeenAt.toISOString()}`,
    );
  }
  if (pings.length === 0) console.log("  (ninguno)");

  // Presence a nivel proveedor (gameId=""), REST 1.0 legada.
  const provPings = await prisma.integrationPing.findMany({
    where: { providerId: game.providerId, gameId: "" },
  });
  console.log("\n=== IntegrationPing a nivel PROVEEDOR (gameId='') ===");
  for (const p of provPings) {
    console.log(`  feature=${p.feature} count=${p.count} last=${p.lastSeenAt.toISOString()}`);
  }
  if (provPings.length === 0) console.log("  (ninguno)");

  // GamePresence REST 1.0
  const gp = await prisma.gamePresence.count({ where: { gameId: game.id } });
  console.log("\nGamePresence (REST 1.0) filas para el juego:", gp);
}

await prisma.$disconnect();
process.exit(0);
