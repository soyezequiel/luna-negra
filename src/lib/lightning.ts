import { NWCClient } from "@getalby/sdk";
import { LightningAddress } from "@getalby/lightning-tools";
import * as Sentry from "@sentry/nextjs";

// Wallets NWC del store, en orden de preferencia. El primero es el primario; el
// segundo (opcional) es el fallback que se usa SÓLO si el primario falla al
// cobrar/pagar. Sirve para todo: cobrar apuestas, cobrar la venta de juegos y
// pagar premios/reembolsos. Configurar con:
//   NWC_CONNECTION_STRING           (primario, obligatorio para salir de modo dev)
//   NWC_CONNECTION_STRING_FALLBACK  (fallback, opcional)
const NWC_URLS = [
  process.env.NWC_CONNECTION_STRING,
  process.env.NWC_CONNECTION_STRING_FALLBACK,
].filter((u): u is string => Boolean(u));

/** ¿Hay al menos un wallet NWC configurado? Si no, el flujo corre en "modo dev". */
export function lightningConfigured(): boolean {
  return NWC_URLS.length > 0;
}

// Clientes NWC reutilizados entre llamadas (uno por wallet): la conexión al relay
// (WebSocket + handshake NWC) tarda segundos en abrirse, así que crear uno nuevo
// por cada consulta hacía que la detección del pago se sintiera muy lenta.
// Mantenemos las conexiones calientes y las compartimos.
const cachedClients: (NWCClient | null)[] = [];

function getClient(i: number): NWCClient {
  const url = NWC_URLS[i];
  if (!url) throw new Error(`Wallet NWC #${i} no configurado`);
  if (!cachedClients[i]) {
    cachedClients[i] = new NWCClient({ nostrWalletConnectUrl: url });
  }
  return cachedClients[i]!;
}

/**
 * Ejecuta una operación de cobro/pago contra el wallet primario; si falla y hay
 * un fallback configurado, reintenta contra el siguiente. Devuelve el resultado
 * del primer wallet que responda OK. Si todos fallan, propaga el último error.
 *
 * IMPORTANTE para pagos: quien llame con un invoice/bolt11 ya emitido debe
 * mantenerlo fijo entre reintentos (no pedir uno nuevo por wallet). Así, si el
 * primario ya pagó pero la respuesta se perdió, el fallback intenta el MISMO
 * invoice y la red lo rechaza por "ya pagado" en vez de pagar dos veces.
 */
async function withFailover<T>(
  op: string,
  fn: (client: NWCClient) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < NWC_URLS.length; i++) {
    try {
      const result = await fn(getClient(i));
      if (i > 0) {
        // El primario falló y salvó el fallback: avisar para que el operador
        // revise el wallet primario (puede estar caído o sin saldo).
        Sentry.captureMessage(
          `NWC ${op}: se usó el wallet fallback #${i} tras fallar el primario`,
          "warning",
        );
      }
      return result;
    } catch (err) {
      lastErr = err;
      const hayFallback = i < NWC_URLS.length - 1;
      Sentry.captureException(err, {
        level: hayFallback ? "warning" : "error",
        tags: { flow: "nwc-failover", op, wallet: i },
      });
    }
  }
  throw lastErr;
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
  return withFailover("makeInvoice", async (client) => {
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
  });
}

/**
 * ¿Está pagado el invoice con este `paymentHash`?
 *
 * Como el cobro pudo haber hecho failover al fallback, no sabemos a priori qué
 * wallet emitió este invoice. Consultamos TODOS los wallets y devolvemos `true`
 * si cualquiera lo da por liquidado. Un wallet que no conoce el invoice lanza
 * (NOT_FOUND) y simplemente probamos el siguiente. Sólo propagamos error si
 * NINGÚN wallet respondió (todos caídos): así no confundimos "wallet offline"
 * con "no pagado".
 */
export async function isInvoicePaid(paymentHash: string): Promise<boolean> {
  let lastErr: unknown;
  let algunoRespondio = false;
  for (let i = 0; i < NWC_URLS.length; i++) {
    try {
      const tx = await getClient(i).lookupInvoice({ payment_hash: paymentHash });
      algunoRespondio = true;
      if (tx.state === "settled") return true;
    } catch (err) {
      // Este wallet no conoce el invoice o está caído: probamos el siguiente.
      lastErr = err;
    }
  }
  if (!algunoRespondio) throw lastErr;
  return false;
}

/** Paga `amountSats` a una Lightning Address. Devuelve el preimage. */
export async function payToLightningAddress(
  lightningAddress: string,
  amountSats: number,
  comment?: string,
): Promise<string> {
  const la = new LightningAddress(lightningAddress);
  await la.fetch();
  // Pedimos el invoice UNA vez, fuera del failover: si el primario ya lo pagó
  // pero falló al responder, el fallback intenta el mismo bolt11 (idempotente).
  const invoice = await la.requestInvoice({ satoshi: amountSats, comment });
  return withFailover("payInvoice", async (client) => {
    const res = await client.payInvoice({ invoice: invoice.paymentRequest });
    return res.preimage;
  });
}

/**
 * Pide un invoice (bolt11) DIRECTAMENTE a una Lightning Address, sin pasar por el
 * wallet de la tienda. Lo usa la propina: el invoice lo emite el wallet del
 * desarrollador, así que el sat va 100% a él y Luna Negra nunca custodia el dinero
 * (no hay payout ni comisión). El usuario lo paga con su wallet/extensión/QR.
 */
export async function requestInvoiceFromAddress(
  lightningAddress: string,
  amountSats: number,
  comment?: string,
): Promise<string> {
  const la = new LightningAddress(lightningAddress);
  await la.fetch();
  const invoice = await la.requestInvoice({ satoshi: amountSats, comment });
  return invoice.paymentRequest;
}

/** Paga un invoice bolt11 ya provisto (ej. LNURL-withdraw). Devuelve el preimage. */
export async function payInvoiceRaw(bolt11: string): Promise<string> {
  return withFailover("payInvoice", async (client) => {
    const res = await client.payInvoice({ invoice: bolt11 });
    return res.preimage;
  });
}
