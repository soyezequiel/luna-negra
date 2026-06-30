import { prisma } from "../src/lib/prisma";

async function main() {
  const r = await prisma.game.findMany({
    select: { id: true, slug: true, title: true, status: true, isBeta: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(JSON.stringify(r, null, 2));
  await prisma.$disconnect();
}
main();
