// Probe read-only del wallet NWC del escrow. No mueve fondos.
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

loadEnv();
const url = process.env.NWC_CONNECTION_STRING;
if (!url) { console.error("NWC_CONNECTION_STRING no está en .env"); process.exit(1); }
try {
  const u = new URL(url.replace(/^nostr\+walletconnect:\/\//, "https://"));
  console.log("relay:", u.searchParams.get("relay"));
  console.log("wallet pubkey:", u.host);
} catch {}

const client = new NWCClient({ nostrWalletConnectUrl: url });
async function step(name, fn) {
  const t0 = Date.now();
  try { console.log(`✅ ${name} (${Date.now() - t0}ms):`, JSON.stringify(await fn())); }
  catch (e) { console.log(`❌ ${name} (${Date.now() - t0}ms):`, e?.message ?? e); }
}
await step("getInfo", () => client.getInfo());
await step("getBalance", () => client.getBalance());
client.close?.();
process.exit(0);
