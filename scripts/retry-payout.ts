// Reintenta UN payout/reembolso en `failed` llamando a la función real del app
// (idempotente vía ledger; no duplica fondos). Mueve sats reales si paga.
//
// Uso: npx tsx scripts/retry-payout.ts <participantId>
import { readFileSync } from "node:fs";

// Cargar .env antes de importar @/lib/prisma (construye el cliente al cargar).
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Uso: npx tsx scripts/retry-payout.ts <participantId>");
    process.exit(1);
  }
  const { retryFailedPayout } = await import("../src/lib/escrow-payout");
  const res = await retryFailedPayout(id);
  console.log("\nRESULT:", res);
  process.exit(0);
}

main();
