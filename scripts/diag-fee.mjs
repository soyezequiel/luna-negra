// READ-ONLY: audita la economía de las apuestas para ver cuánta comisión real
// acumuló la casa. Por cada apuesta liquidada muestra depósitos, payouts/refunds,
// fee registrado y el "neto en wallet" (lo que entró menos lo que salió). Al final
// agrega totales y un desglose por estado final. No paga ni modifica nada.
//
// Uso: node scripts/diag-fee.mjs
import { readFileSync } from "node:fs";

// Cargar DATABASE_URL desde .env (el cliente Prisma en runtime no lo hace solo).
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const sats = (msat) => (Number(msat) / 1000).toLocaleString("es-AR", { maximumFractionDigits: 3 });

const bets = await prisma.bet.findMany({
  orderBy: { createdAt: "desc" },
  include: {
    game: { select: { title: true } },
    ledger: { select: { kind: true, status: true, amountMsat: true } },
    participants: { select: { depositStatus: true, payoutStatus: true, result: true } },
  },
});

// Acumuladores globales (solo asientos settled = plata que de verdad se movió).
let gDeposit = 0n, gPayout = 0n, gRefund = 0n, gFee = 0n, gForfeit = 0n;
const porEstado = {};

console.log(`\nApuestas totales: ${bets.length}\n`);

for (const b of bets) {
  const sum = (kind, status = "settled") =>
    b.ledger
      .filter((e) => e.kind === kind && e.status === status)
      .reduce((a, e) => a + e.amountMsat, 0n);

  const deposit = sum("deposit");
  const payout = sum("payout");
  const refund = sum("refund");
  const fee = sum("fee");
  const forfeit = sum("forfeit");
  // Lo que de verdad queda en la wallet del escrow por esta apuesta:
  const neto = deposit - payout - refund;

  gDeposit += deposit; gPayout += payout; gRefund += refund; gFee += fee; gForfeit += forfeit;
  porEstado[b.status] = (porEstado[b.status] ?? 0) + 1;

  // Asientos de fee que quedaron pending/failed (registrados pero no liquidados).
  const feePend = b.ledger.filter((e) => e.kind === "fee" && e.status !== "settled");

  console.log("─".repeat(64));
  console.log(`bet ${b.id}  [${b.game?.title ?? "?"}]`);
  console.log(`  estado=${b.status}  feePct=${b.feePct}%  stake=${sats(b.stakeMsat)} sats × ${b.participants.length}`);
  console.log(`  depósitos : ${sats(deposit).padStart(12)} sats`);
  console.log(`  payouts   : ${sats(payout).padStart(12)} sats`);
  console.log(`  refunds   : ${sats(refund).padStart(12)} sats`);
  console.log(`  fee (reg) : ${sats(fee).padStart(12)} sats${feePend.length ? `  ⚠ ${feePend.length} asiento(s) fee NO settled` : ""}`);
  console.log(`  → NETO en wallet: ${sats(neto).padStart(10)} sats  ${neto > 0n ? "✅ ganancia" : neto < 0n ? "❌ pérdida" : "— cero"}`);
}

console.log("═".repeat(64));
console.log("TOTALES (solo asientos settled):");
console.log(`  depósitos entrados : ${sats(gDeposit).padStart(14)} sats`);
console.log(`  payouts pagados    : ${sats(gPayout).padStart(14)} sats`);
console.log(`  refunds pagados    : ${sats(gRefund).padStart(14)} sats`);
console.log(`  fee registrado     : ${sats(gFee).padStart(14)} sats`);
console.log(`  forfeit registrado : ${sats(gForfeit).padStart(14)} sats`);
console.log("  " + "-".repeat(40));
console.log(`  NETO total en wallet: ${sats(gDeposit - gPayout - gRefund).padStart(13)} sats`);
console.log("");
console.log("Apuestas por estado final:");
for (const [estado, n] of Object.entries(porEstado).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${estado.padEnd(22)} ${n}`);
}
console.log("═".repeat(64));
console.log("\nNota: el 'NETO en wallet' es tu ganancia real (lo que entró menos lo");
console.log("que saliste a pagar). Debería ≈ fee registrado en apuestas con ganador.");
console.log("Si una apuesta settled tiene neto 0 o fee 0, terminó en reembolso/empate.\n");

await prisma.$disconnect();
