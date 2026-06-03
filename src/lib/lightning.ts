import { NWCClient } from "@getalby/sdk";
import { LightningAddress } from "@getalby/lightning-tools";

const NWC_URL = process.env.NWC_CONNECTION_STRING;

/** ¿Hay un wallet NWC configurado? Si no, el flujo corre en "modo dev". */
export function lightningConfigured(): boolean {
  return Boolean(NWC_URL);
}

function getClient(): NWCClient {
  if (!NWC_URL) throw new Error("NWC_CONNECTION_STRING no configurado");
  return new NWCClient({ nostrWalletConnectUrl: NWC_URL });
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
  try {
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
  } finally {
    client.close();
  }
}

export async function isInvoicePaid(paymentHash: string): Promise<boolean> {
  const client = getClient();
  try {
    const tx = await client.lookupInvoice({ payment_hash: paymentHash });
    return tx.state === "settled";
  } finally {
    client.close();
  }
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
  try {
    const res = await client.payInvoice({ invoice: invoice.paymentRequest });
    return res.preimage;
  } finally {
    client.close();
  }
}
