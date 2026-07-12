/**
 * Borra el ping stale de presencia NGP (IntegrationPing feature="ngp:presencia")
 * de un juego cuya presencia NIP-38 ya NO existe en relays — el falso positivo
 * "Detectado" del panel de integración.
 *
 * Uso (contra la DB que apunte DATABASE_URL, p. ej. producción):
 *   node tmp/clear-presence-ping.mjs                 # dry-run futbolcillo (no borra)
 *   node tmp/clear-presence-ping.mjs --apply         # BORRA el ping de futbolcillo
 *   node tmp/clear-presence-ping.mjs otro-slug        # dry-run de otro juego
 *   node tmp/clear-presence-ping.mjs otro-slug --apply
 *
 * Seguro: solo toca filas (gameId de ESE juego, feature exactamente "ngp:presencia").
 * No toca otras capacidades, otros juegos, ni la presencia a nivel proveedor.
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const slug = args.find((a) => !a.startsWith("--")) ?? "futbolcillo";
const FEATURE = "ngp:presencia";

const prisma = new PrismaClient();

const game = await prisma.game.findFirst({
  where: { slug },
  select: { id: true, slug: true, providerId: true, nostrCoord: true },
});

if (!game) {
  console.error(`✗ No existe un juego con slug="${slug}" en esta DB.`);
  console.error(`  (¿DATABASE_URL apunta a la base correcta? La local 127.0.0.1 no tiene los juegos de prod.)`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`Juego: ${game.slug}  gameId=${game.id}`);
console.log(`Coord: ${game.nostrCoord}`);

const target = await prisma.integrationPing.findMany({
  where: { gameId: game.id, feature: FEATURE },
});

if (target.length === 0) {
  console.log(`\nNo hay ping "${FEATURE}" para este juego — nada que borrar.`);
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`\nPing(s) "${FEATURE}" a borrar:`);
for (const p of target) {
  console.log(
    `  count=${p.count}  first=${p.firstSeenAt.toISOString()}  last=${p.lastSeenAt.toISOString()}`,
  );
}

if (!apply) {
  console.log(`\n[DRY-RUN] No se borró nada. Volvé a correr con --apply para borrar.`);
  await prisma.$disconnect();
  process.exit(0);
}

const res = await prisma.integrationPing.deleteMany({
  where: { gameId: game.id, feature: FEATURE },
});
console.log(`\n✓ Borradas ${res.count} fila(s). El panel dejará de mostrar presencia "Detectado" para ${game.slug}.`);

await prisma.$disconnect();
process.exit(0);
