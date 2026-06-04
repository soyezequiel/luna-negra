// CLI para probar apuestas sin tener el game server integrado.
// Firma como el PROVEEDOR (la cuenta dueña del juego en Luna Negra).
//
// Requisitos de entorno:
//   PROVIDER_NSEC  → nsec de la cuenta que creó el proveedor en /provider
//   BASE_URL       → opcional (default: https://luna-negra-three.vercel.app)
//
// Uso (PowerShell):
//   $env:PROVIDER_NSEC="nsec1..."
//   node scripts/bet-cli.mjs create <gameId> <stakeSats> <npubA> <npubB> ["condición"]
//   node scripts/bet-cli.mjs result <betId> <npubGanador> [<npubGanador2> ...]
//
// Uso (bash):
//   PROVIDER_NSEC=nsec1... node scripts/bet-cli.mjs create <gameId> 10 npub1a npub1b "mayor puntaje"
//
// El gameId lo sacás de `npx prisma studio` → tabla Game → columna id.

import { finalizeEvent } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { createHash } from "node:crypto";

const BASE_URL = (process.env.BASE_URL || "https://luna-negra-three.vercel.app").replace(/\/$/, "");

function getSecretKey() {
  const nsec = process.env.PROVIDER_NSEC;
  if (!nsec) {
    console.error("Falta PROVIDER_NSEC (nsec de la cuenta dueña del juego).");
    process.exit(1);
  }
  const d = nip19.decode(nsec.trim());
  if (d.type !== "nsec") {
    console.error("PROVIDER_NSEC no es un nsec válido.");
    process.exit(1);
  }
  return d.data; // Uint8Array
}

const now = () => Math.floor(Date.now() / 1000);

async function create(gameId, stakeSats, npubs, condition) {
  const sk = getSecretKey();
  const url = `${BASE_URL}/api/escrow/bets`;
  const body = JSON.stringify({
    gameId,
    participants: npubs,
    stakeSats: Number(stakeSats),
    victoryCondition: condition || "mayor puntaje",
  });
  const payload = createHash("sha256").update(body).digest("hex");
  const authEvent = finalizeEvent(
    {
      kind: 27235,
      created_at: now(),
      tags: [["u", url], ["method", "POST"], ["payload", payload]],
      content: "",
    },
    sk,
  );
  const auth = "Nostr " + Buffer.from(JSON.stringify(authEvent)).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body,
  });
  console.log(res.status, await res.text());
}

async function result(betId, winnerNpubs) {
  const sk = getSecretKey();
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: now(),
      tags: [["bet", betId], ...winnerNpubs.map((w) => ["winner", w])],
      content: `Resultado apuesta ${betId}`,
    },
    sk,
  );
  const res = await fetch(`${BASE_URL}/api/escrow/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  });
  console.log(res.status, await res.text());
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "create") {
  const [gameId, stakeSats, ...rest] = args;
  // los npubs son los args que empiezan con "npub"; el último no-npub es la condición
  const npubs = rest.filter((a) => a.startsWith("npub"));
  const condition = rest.find((a) => !a.startsWith("npub"));
  if (!gameId || !stakeSats || npubs.length < 2) {
    console.error('Uso: create <gameId> <stakeSats> <npubA> <npubB> ["condición"]');
    process.exit(1);
  }
  await create(gameId, stakeSats, npubs, condition);
} else if (cmd === "result") {
  const [betId, ...winners] = args;
  if (!betId || winners.length < 1) {
    console.error("Uso: result <betId> <npubGanador> [<npubGanador2> ...]");
    process.exit(1);
  }
  await result(betId, winners);
} else {
  console.error("Comandos: create | result");
  process.exit(1);
}
