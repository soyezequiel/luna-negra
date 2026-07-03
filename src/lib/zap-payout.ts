import { nip57 } from "nostr-tools";
import { resolveZapEndpointForAddress, buildUnsignedZapRequest } from "@/lib/zap";
import { signZapRequest } from "@/lib/nostr-server";
import {
  lightningConfigured,
  payInvoiceRaw,
  payToLightningAddress,
} from "@/lib/lightning";
import { msatToSats } from "@/lib/money";
import { notifyOperationalError, notifyNonSocialZap } from "@/lib/discord";

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
  let zapFailure: Error | null = null;

  // Anclamos el zap al contrato (`e` = nota de la apuesta) para que el pago al
  // ganador aparezca SOBRE la apuesta, igual que los depósitos, y no como un
  // profile-zap suelto en su perfil. El recibo 9735 lo emite el wallet del ganador
  // copiando este `e`, así los clientes lo muestran en la nota. Sin ancla real
  // (dev-anchor/null) cae a profile-zap.
  const anchor =
    opts.anchorEventId && !opts.anchorEventId.startsWith("dev-anchor-")
      ? opts.anchorEventId
      : null;
  if (endpoint && opts.recipientPubkey) {
    const unsigned = buildUnsignedZapRequest({
      amountSats,
      comment: opts.comment,
      recipientPubkey: opts.recipientPubkey,
      eventId: anchor,
      eventKind: anchor ? 1 : null,
      lnurl: endpoint.lnurl,
    });
    const signed = signZapRequest(unsigned);
    if (signed) {
      try {
        const invoice = await fetchZapInvoiceChecked(endpoint, amountSats, signed);
        const preimage = await payInvoiceRaw(invoice);
        return { kind: "zap", zapRequestId: signed.id, preimage, destination: address };
      } catch (error) {
        zapFailure = error instanceof Error ? error : new Error("Falló el zap NIP-57");
        // Si el zap falla (LNURL caído / invoice inválido), caemos al pago LNURL
        // normal más abajo: la plata igual se mueve; la auditoría la da la nota.
      }
    } else {
      zapFailure = new Error("No se pudo firmar el zap request; revisá LUNA_NEGRA_NSEC");
    }
  } else if (!endpoint) {
    zapFailure = new Error("La Lightning Address no anuncia soporte NIP-57");
  } else {
    zapFailure = new Error("Falta la pubkey Nostr del receptor del payout");
  }

  if (zapFailure) {
    await notifyNonSocialZap({
      flow: `payout saliente${opts.comment ? ` (${opts.comment})` : ""}`,
      reason: `El pago al receptor cae al riel LNURL normal en vez de un zap NIP-57: ${zapFailure.message}. La plata se mueve igual, pero NO se emite recibo 9735 público.`,
      fingerprint: `zap-payout-fallback:${address}:${zapFailure.message}`,
      cooldownMs: 30 * 60_000,
      context: {
        address,
        recipientPubkey: opts.recipientPubkey,
        anchorEventId: opts.anchorEventId,
        amountMsat: amountMsat.toString(),
        operation: opts.comment,
      },
    });
  }

  // Fallback LNURL: pago normal a la Lightning Address (sin recibo 9735).
  try {
    const preimage = await payToLightningAddress(address, amountSats, opts.comment ?? "");
    return { kind: "lnurl", preimage, destination: address };
  } catch (e) {
    await notifyOperationalError({
      source: "zap-payout-failed",
      error: e,
      fingerprint: `zap-payout-failed:${address}:${opts.comment ?? "unknown"}`,
      context: {
        address,
        recipientPubkey: opts.recipientPubkey,
        amountMsat: amountMsat.toString(),
        operation: opts.comment,
      },
    });
    return { kind: "failed", error: e instanceof Error ? e.message : "pago falló" };
  }
}

/**
 * Pide el invoice al LNURL del receptor con el 9734 firmado y VERIFICA que el
 * monto del bolt11 coincida con lo que vamos a pagar (defensa contra un LNURL que
 * devuelva un invoice por un monto distinto). Lanza si no coincide.
 *
 * Trabaja en sats enteros (no msat): Lightning no paga sub-sat y varios wallets
 * (ej. Wallet of Satoshi) sólo emiten invoices por sats enteros redondeando
 * hacia arriba un `amount` msat fraccionario. Si le pasáramos el msat crudo
 * (ej. 19800 = 19,8 sats) el wallet devolvería 20 sats y la verificación —que
 * trunca a 19— lo rechazaría. Pedimos exactamente `amountSats * 1000` msat para
 * que el amount tag del 9734, el callback y el bolt11 coincidan en 1 sat.
 */
async function fetchZapInvoiceChecked(
  endpoint: { callback: string; lnurl: string },
  amountSats: number,
  signed: { id: string } & Record<string, unknown>,
): Promise<string> {
  const { fetchZapInvoice } = await import("@/lib/zap");
  const invoice = await fetchZapInvoice({
    callback: endpoint.callback,
    amountMsat: amountSats * 1000,
    signedZapRequest: JSON.stringify(signed),
    lnurl: endpoint.lnurl,
  });
  const invoiceSats = nip57.getSatoshisAmountFromBolt11(invoice);
  if (invoiceSats !== amountSats) {
    throw new Error(
      `El invoice del receptor es por ${invoiceSats} sats, esperábamos ${amountSats}`,
    );
  }
  return invoice;
}
