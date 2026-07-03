import { nip57 } from "nostr-tools";
import { resolveZapEndpointForAddress, buildUnsignedZapRequest } from "@/lib/zap";
import { signZapRequest } from "@/lib/nostr-server";
import {
  lightningConfigured,
  payInvoiceRaw,
  payToLightningAddress,
} from "@/lib/lightning";
import { msatToSats } from "@/lib/money";

// Motor de zaps SALIENTES de apuestas v2 (payout al ganador / refund / fees).
// Luna Negra es la que zapea: firma el 9734 con su nsec (`p` = receptor, sin
// `e`, o sea profile-zap), le pide el invoice al LNURL del receptor, VERIFICA el
// monto del bolt11 antes de pagar y lo paga con el NWC. El recibo 9735 lo emite
// el wallet del receptor (zap real, visible para el ganador). Fallbacks: wallet
// sin zaps → pago LNURL normal; sin dirección → el caller marca withdraw_pending
// (QR de retiro, como v1).

export type ZapPayoutResult =
  | { kind: "zap"; zapRequestId: string; preimage: string; destination: string }
  | { kind: "lnurl"; preimage: string; destination: string }
  | { kind: "withdraw" }
  | { kind: "failed"; error: string };

/**
 * Mueve `amountMsat` a `address` como profile-zap, o por los fallbacks.
 * NO toca DB ni el ledger: el caller registra el outflow y marca settled/failed.
 *  - `address` null → { kind: "withdraw" } (el caller abre el QR de retiro).
 *  - dev sin NWC → preimage simulado (kind según haya address).
 */
export async function sendZapPayout(opts: {
  anchorEventId: string | null;
  recipientPubkey: string | null;
  address: string | null;
  amountMsat: bigint;
  comment?: string;
}): Promise<ZapPayoutResult> {
  const { address, amountMsat } = opts;
  if (!address) return { kind: "withdraw" };

  const amountSats = Number(msatToSats(amountMsat));

  // Dev sin NWC: simular el pago para poder probar el flujo (sin publicar nada).
  if (!lightningConfigured()) {
    return { kind: "lnurl", preimage: "dev-preimage", destination: address };
  }

  const endpoint = await resolveZapEndpointForAddress(address).catch(() => null);

  // Sin eventId es un profile-zap tienda -> receptor, visible para el ganador.
  if (endpoint && opts.recipientPubkey) {
    const unsigned = buildUnsignedZapRequest({
      amountSats,
      comment: opts.comment,
      recipientPubkey: opts.recipientPubkey,
      lnurl: endpoint.lnurl,
    });
    const signed = signZapRequest(unsigned);
    if (signed) {
      try {
        const invoice = await fetchZapInvoiceChecked(endpoint, amountMsat, signed);
        const preimage = await payInvoiceRaw(invoice);
        return { kind: "zap", zapRequestId: signed.id, preimage, destination: address };
      } catch {
        // Si el zap falla (LNURL caído / invoice inválido), caemos al pago LNURL
        // normal más abajo: la plata igual se mueve; la auditoría la da la nota.
      }
    }
  }

  // Fallback LNURL: pago normal a la Lightning Address (sin recibo 9735).
  try {
    const preimage = await payToLightningAddress(address, amountSats, opts.comment ?? "");
    return { kind: "lnurl", preimage, destination: address };
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : "pago falló" };
  }
}

/**
 * Pide el invoice al LNURL del receptor con el 9734 firmado y VERIFICA que el
 * monto del bolt11 coincida con lo que vamos a pagar (defensa contra un LNURL que
 * devuelva un invoice por un monto distinto). Lanza si no coincide.
 */
async function fetchZapInvoiceChecked(
  endpoint: { callback: string; lnurl: string },
  amountMsat: bigint,
  signed: { id: string } & Record<string, unknown>,
): Promise<string> {
  const { fetchZapInvoice } = await import("@/lib/zap");
  const invoice = await fetchZapInvoice({
    callback: endpoint.callback,
    amountMsat: Number(amountMsat),
    signedZapRequest: JSON.stringify(signed),
    lnurl: endpoint.lnurl,
  });
  const invoiceSats = nip57.getSatoshisAmountFromBolt11(invoice);
  const expectedSats = Number(msatToSats(amountMsat));
  if (invoiceSats !== expectedSats) {
    throw new Error(
      `El invoice del receptor es por ${invoiceSats} sats, esperábamos ${expectedSats}`,
    );
  }
  return invoice;
}
