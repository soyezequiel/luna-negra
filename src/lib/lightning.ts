import { NWCClient } from "@getalby/sdk";
import { LightningAddress } from "@getalby/lightning-tools";

const NWC_URL = process.env.NWC_CONNECTION_STRING;

/** ¿Hay un wallet NWC configurado? Si no, el flujo corre en "modo dev". */
export function lightningConfigured(): boolean {
  return Boolean(NWC_URL);
}

// Cliente NWC reutilizado entre llamadas: la conexión al relay (WebSocket +
// handshake NWC) tarda segundos en abrirse, así que crear uno nuevo por cada
// consulta hacía que la detección del pago se sintiera muy lenta. Mantenemos
// la conexión caliente y la compartimos.
let cachedClient: NWCClient | null = null;

function getClient(): NWCClient {
  if (!NWC_URL) throw new Error("NWC_CONNECTION_STRING no configurado");
  if (!cachedClient) {
    console.log("[LN] creando NWCClient nuevo (conexión fría)");
    cachedClient = new NWCClient({ nostrWalletConnectUrl: NWC_URL });
  }
  return cachedClient;
}

export type CreatedInvoice = {
  invoice: string; // bolt11
  paymentHash: string;
  expiresAt: number; // unix seconds
};

/** Crea un invoice para cobrar `amountSats` (NWC usa msat). */
export async function createInvoice(
  amountSats: number,
  description: string,
): Promise<CreatedInvoice> {
  const client = getClient();
  const tx = await client.makeInvoice({
    amount: amountSats * 1000,
    description,
    expiry: 60 * 15,
  });
  return {
    invoice: tx.invoice,
    paymentHash: tx.payment_hash,
    expiresAt: tx.expires_at,
  };
}

export async function isInvoicePaid(paymentHash: string): Promise<boolean> {
  const client = getClient();
  const t0 = Date.now();
  const tx = await client.lookupInvoice({ payment_hash: paymentHash });
  console.log(
    `[LN] lookupInvoice ${paymentHash.slice(0, 8)}… state=${tx.state} en ${Date.now() - t0}ms`,
  );
  return tx.state === "settled";
}

/** Paga `amountSats` a una Lightning Address. Devuelve el preimage. */
export async function payToLightningAddress(
  lightningAddress: string,
  amountSats: number,
  comment?: string,
): Promise<string> {
  const la = new LightningAddress(lightningAddress);
  await la.fetch();
  const invoice = await la.requestInvoice({ satoshi: amountSats, comment });
  const client = getClient();
  const res = await client.payInvoice({ invoice: invoice.paymentRequest });
  return res.preimage;
}

/** Paga un invoice bolt11 ya provisto (ej. LNURL-withdraw). Devuelve el preimage. */
export async function payInvoiceRaw(bolt11: string): Promise<string> {
  const client = getClient();
  const res = await client.payInvoice({ invoice: bolt11 });
  return res.preimage;
}
