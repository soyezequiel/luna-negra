import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStorePubkey } from "@/lib/nostr-server";
import { ensureDepositInvoiceV2, validateDepositZapRequest } from "@/lib/zap-bet";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";

// LNURL-pay (LUD-06) + NIP-57 para el depósito de un participante v2. Dos pasos:
//   1) GET sin `?amount`  → payRequest (callback + min/max = stake fijo) con
//      `allowsNostr: true` y `nostrPubkey` = la tienda (firmante de los 9735).
//   2) GET con `?amount`  → { pr: <bolt11> }. Si viene `?nostr=` (9734 firmado), se
//      valida y se guarda para el recibo posterior; el invoice lo emite el NWC.
// Permite pagar el depósito por QR desde cualquier wallet LNURL y deja los recibos
// verificables por terceros (firmante del 9735 == nostrPubkey del endpoint).

const lnurlError = (reason: string) =>
  NextResponse.json({ status: "ERROR", reason });

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
  const open =
    bet.status === "pending_deposits" &&
    (bet.depositDeadline == null || bet.depositDeadline > new Date());
  if (!open) return lnurlError("El depósito está cerrado");
  if (part.depositStatus === "paid") return lnurlError("Ya depositaste");

  const amountMsat = Number(bet.stakeMsat);
  const url = new URL(req.url);
  const amount = url.searchParams.get("amount");

  // Paso 2: el wallet pide el invoice por el monto exacto.
  if (amount != null) {
    if (Number(amount) !== amountMsat) {
      return lnurlError(`Monto debe ser exactamente ${amountMsat} msat`);
    }
    // Zap opcional: si el wallet manda un 9734 firmado, lo validamos y guardamos
    // para el recibo. Si no coincide con el contrato, lo ignoramos (pago normal).
    let signed: SignedZapRequest | null = null;
    const nostrParam = url.searchParams.get("nostr");
    if (nostrParam) {
      try {
        const candidate = JSON.parse(nostrParam) as SignedZapRequest;
        if (validateDepositZapRequest(bet, part, candidate).ok) signed = candidate;
      } catch {
        /* nostr param corrupto → pago LNURL normal, sin recibo del emisor */
      }
    }
    try {
      const inv = await ensureDepositInvoiceV2(bet, part, signed);
      return NextResponse.json({ pr: inv.invoice, routes: [] });
    } catch (e) {
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
    callback: `${url.origin}${url.pathname}`,
    minSendable: amountMsat,
    maxSendable: amountMsat,
    metadata,
  };
  if (storePubkey) {
    res.allowsNostr = true;
    res.nostrPubkey = storePubkey;
  }
  return NextResponse.json(res);
}
