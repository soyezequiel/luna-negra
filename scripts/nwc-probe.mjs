// Probe read-only de los wallets NWC del escrow. No mueve fondos.
// Prueba el wallet primario (NWC_CONNECTION_STRING) y, si está, el fallback
// (NWC_CONNECTION_STRING_FALLBACK).
import { readFileSync } from "node:fs";
import { NWCClient } from "@getalby/sdk";

function loadEnv() {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

async function step(client, name, fn) {
  const t0 = Date.now();
  try { console.log(`  ✅ ${name} (${Date.now() - t0}ms):`, JSON.stringify(await fn(client))); }
  catch (e) { console.log(`  ❌ ${name} (${Date.now() - t0}ms):`, e?.message ?? e); }
}

async function probe(label, url) {
  console.log(`\n=== ${label} ===`);
  try {
    const u = new URL(url.replace(/^nostr\+walletconnect:\/\//, "https://"));
    console.log("relay:", u.searchParams.get("relay"));
    console.log("wallet pubkey:", u.host);
  } catch {}

  const client = new NWCClient({ nostrWalletConnectUrl: url });
  await step(client, "getInfo", (c) => c.getInfo());
  await step(client, "getBalance", (c) => c.getBalance());
  client.close?.();
}

loadEnv();

const wallets = [
  ["PRIMARIO (NWC_CONNECTION_STRING)", process.env.NWC_CONNECTION_STRING],
  ["FALLBACK (NWC_CONNECTION_STRING_FALLBACK)", process.env.NWC_CONNECTION_STRING_FALLBACK],
].filter(([, url]) => Boolean(url));

if (wallets.length === 0) {
  console.error("Ningún wallet NWC configurado en .env (NWC_CONNECTION_STRING / NWC_CONNECTION_STRING_FALLBACK)");
  process.exit(1);
}

for (const [label, url] of wallets) {
  await probe(label, url);
}
process.exit(0);
