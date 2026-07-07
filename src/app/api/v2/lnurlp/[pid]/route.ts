import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStorePubkey } from "@/lib/nostr-server";
import { ensureDepositInvoiceV2, validateDepositZapRequest } from "@/lib/zap-bet";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";
import { siteUrl } from "@/lib/site-url";
import { notifyBetPaymentDiagnostic, notifyOperationalError } from "@/lib/discord";

// LNURL-pay (LUD-06) + NIP-57 para el depósito de un participante v2. Dos pasos:
//   1) GET sin `?amount`  → payRequest (callback + min/max = stake fijo) con
//      `allowsNostr: true` y `nostrPubkey` = la tienda (firmante de los 9735).
//   2) GET con `?amount&nostr=` → valida y guarda el 9734 firmado; el invoice lo
//      emite el NWC. Sin `nostr` válido no hay invoice: el depósito debe ser un zap
//      social real para que el 9735 sea reconocido por clientes Nostr.
// Permite pagar el depósito por QR desde wallets LNURL con NIP-57 o desde la UI web
// de Luna Negra, y deja los recibos verificables por terceros.

const LNURL_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

const lnurlError = (reason: string) =>
  NextResponse.json({ status: "ERROR", reason }, { headers: LNURL_HEADERS });

type SignedZapRequest = {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  id: string;
  sig: string;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ pid: string }> },
) {
  if (!BETS_V2_ENABLED) return lnurlError("Apuestas v2 desactivadas");
  const { pid } = await params;
  const part = await prisma.zapBetParticipant.findUnique({
    where: { id: pid },
    include: { bet: true },
  });
  if (!part) return lnurlError("Participante no encontrado");

  const bet = part.bet;
  const amountMsat = Number(bet.stakeMsat);
  const url = new URL(req.url);
  const amount = url.searchParams.get("amount");

  // Paso 2: el wallet pide el invoice por el monto exacto y con un 9734 firmado.
  if (amount != null) {
    const open =
      bet.status === "pending_deposits" &&
      (bet.depositDeadline == null || bet.depositDeadline > new Date());
    if (!open) return lnurlError("El depósito está cerrado");
    if (part.depositStatus === "paid") return lnurlError("Ya depositaste");
    if (Number(amount) !== amountMsat) {
      return lnurlError(`Monto debe ser exactamente ${amountMsat} msat`);
    }
    // Zap obligatorio: sin 9734 firmado no hay invoice ni recibo social válido.
    let signed: SignedZapRequest;
    const nostrParam = url.searchParams.get("nostr");
    if (!nostrParam) {
      return lnurlError("Este depósito requiere un zap request NIP-57 firmado");
    }
    try {
      signed = JSON.parse(nostrParam) as SignedZapRequest;
    } catch {
      return lnurlError("Zap request inválido");
    }
    const validation = validateDepositZapRequest(bet, part, signed, siteUrl(req));
    if (!validation.ok) return lnurlError(validation.error);
    try {
      const startedAt = Date.now();
      const inv = await ensureDepositInvoiceV2(bet, part, signed);
      void notifyBetPaymentDiagnostic({
        source: "luna-lnurlp",
        stage: "lnurl-invoice-response",
        fingerprint: `lnurl-invoice-response:${part.id}:${inv.paymentHash}`,
        context: {
          betId: bet.id,
          participantId: part.id,
          anchorEventId: bet.anchorEventId,
          amountMsat: amount,
          paymentHash: inv.paymentHash,
          elapsedMs: Date.now() - startedAt,
          devMode: inv.devMode,
        },
      });
      return NextResponse.json(
        { pr: inv.invoice, routes: [] },
        { headers: LNURL_HEADERS },
      );
    } catch (e) {
      await notifyOperationalError({
        source: "lnurl-participant-deposit-invoice",
        error: e,
        fingerprint: `lnurl-participant-deposit-invoice:${part.id}`,
        context: { betId: bet.id, participantId: part.id, amountMsat: amount },
      });
      return lnurlError(
        e instanceof Error ? e.message : "No se pudo generar el invoice",
      );
    }
  }

  // Paso 1: parámetros del payRequest (monto fijo = stake) + capacidad NIP-57.
  const storePubkey = getStorePubkey();
  const metadata = JSON.stringify([
    ["text/plain", `Luna Negra · depósito apuesta ${bet.id}`],
  ]);
  const res: Record<string, unknown> = {
    tag: "payRequest",
    // Callback canónico (https, dominio público). `url.origin` detrás del proxy
    // puede ser http/host interno y la wallet aborta el pago; usamos siteUrl.
    callback: `${siteUrl(req)}${url.pathname}`,
    minSendable: amountMsat,
    maxSendable: amountMsat,
    metadata,
  };
  if (storePubkey) {
    res.allowsNostr = true;
    res.nostrPubkey = storePubkey;
  }
  return NextResponse.json(res, { headers: LNURL_HEADERS });
}
