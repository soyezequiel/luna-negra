import { SimplePool } from "nostr-tools";

const COORD = "30023:ed13c471be6bff9195a6261d8cbd6c7ab6efe79a7947b208d2b6f066b99cc4d3:futbolcillo";
const RELAYS = [
  "wss://relay.lacrypta.ar",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

const pool = new SimplePool();
const nowSec = Math.floor(Date.now() / 1000);

const all = await pool.querySync(
  RELAYS,
  { kinds: [30315], "#a": [COORD] },
  { maxWait: 8000 },
);

console.log("=== kind:30315 con #a =", COORD, "===");
console.log("total eventos historicos:", all.length);

const byPk = new Map();
for (const ev of all) {
  const prev = byPk.get(ev.pubkey);
  if (!prev || ev.created_at > prev.created_at) byPk.set(ev.pubkey, ev);
}
console.log("pubkeys distintas:", byPk.size);

for (const ev of [...all].sort((a, b) => b.created_at - a.created_at).slice(0, 20)) {
  const exp = ev.tags.find((t) => t[0] === "expiration")?.[1];
  const ageMin = ((nowSec - ev.created_at) / 60).toFixed(1);
  console.log(
    `  pk=${ev.pubkey.slice(0, 12)} created=${new Date(ev.created_at * 1000).toISOString()} (hace ${ageMin} min) content=${JSON.stringify(ev.content)} exp=${exp ?? "-"}`,
  );
}

const fresh = all.filter((ev) => ev.created_at > nowSec - 180);
console.log("\neventos en los ultimos 180s:", fresh.length);
const activos = fresh.filter((ev) => {
  const exp = Number(ev.tags.find((t) => t[0] === "expiration")?.[1]);
  return ev.content.length > 0 && !(exp < nowSec);
});
console.log("activos ahora (content!=vacio y no vencidos):", activos.length);

// Comparo: ¿existe algun 30315 de estas pubkeys SIN el tag `a` (presencia generica)?
if (byPk.size > 0) {
  const pks = [...byPk.keys()];
  const anyStatus = await pool.querySync(RELAYS, { kinds: [30315], authors: pks }, { maxWait: 6000 });
  const sinCoord = anyStatus.filter((ev) => !ev.tags.some((t) => t[0] === "a"));
  console.log("\n(control) 30315 de esas pubkeys SIN tag a:", sinCoord.length);
}

pool.close(RELAYS);
process.exit(0);
