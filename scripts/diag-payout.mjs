// READ-ONLY: lista los payouts/reembolsos en estado `failed` y su asiento de
// ledger asociado, para identificar el participante a reintentar. No paga nada.
//
// Uso: node scripts/diag-payout.mjs
import { readFileSync } from "node:fs";

// Cargar DATABASE_URL desde .env (el cliente Prisma en runtime no lo hace solo).
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const failed = await prisma.betParticipant.findMany({
  where: { payoutStatus: "failed" },
  include: { bet: { select: { id: true, status: true, stakeMsat: true, game: { select: { title: true } } } } },
});

console.log(`\nParticipantes en payoutStatus="failed": ${failed.length}\n`);

for (const p of failed) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { betId: p.betId, userId: p.userId },
    select: { kind: true, status: true, amountMsat: true, idempotencyKey: true },
  });
  console.log("─".repeat(60));
  console.log("participantId :", p.id);
  console.log("betId         :", p.betId, `(${p.bet.game?.title ?? "?"}, bet.status=${p.bet.status})`);
  console.log("npub          :", p.npub);
  console.log("payoutMsat    :", p.payoutMsat?.toString() ?? "null");
  console.log("payoutDest    :", p.payoutDestination ?? "null");
  console.log("depositStatus :", p.depositStatus);
  console.log("ledger entries:");
  for (const e of entries) {
    console.log(`   ${e.kind.padEnd(8)} ${e.status.padEnd(8)} ${e.amountMsat.toString().padStart(10)} msat  [${e.idempotencyKey}]`);
  }
}
console.log("─".repeat(60));

await prisma.$disconnect();
