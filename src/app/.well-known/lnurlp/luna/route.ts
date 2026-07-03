import { NextResponse } from "next/server";
import { nip57 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { getStorePubkey } from "@/lib/nostr-server";
import { ensureDepositInvoiceV2, validateDepositZapRequest } from "@/lib/zap-bet";
import {
  BET_MAX_MSAT,
  BET_MIN_MSAT,
  BETS_V2_ENABLED,
} from "@/lib/escrow-v2-config";
import {
  siteUrl,
  storeLightningAddress,
  storeLnurlUrl,
} from "@/lib/site-url";
import { notifyOperationalError } from "@/lib/discord";

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

const tagValue = (event: SignedZapRequest, name: string): string | undefined =>
  event.tags.find((tag) => tag[0] === name)?.[1];

/**
 * LNURL-pay estable de Luna Negra. Es el lud16 del perfil Nostr y permite que
 * los clientes descubran el firmante de los recibos despues de liquidar.
 */
export async function GET(req: Request) {
  if (!BETS_V2_ENABLED) return lnurlError("Apuestas v2 desactivadas");

  const baseUrl = siteUrl(req);
  const callback = storeLnurlUrl(baseUrl);
  const storePubkey = getStorePubkey();
  if (!storePubkey) {
    return lnurlError("Identidad Nostr de Luna Negra no configurada");
  }

  const url = new URL(req.url);
  const amount = url.searchParams.get("amount");
  if (amount == null) {
    const identifier = storeLightningAddress(baseUrl);
    return NextResponse.json(
      {
        tag: "payRequest",
        callback,
        minSendable: Number(BET_MIN_MSAT),
        maxSendable: Number(BET_MAX_MSAT),
        metadata: JSON.stringify([
          ["text/plain", "Luna Negra - deposito de apuesta"],
          ...(identifier ? [["text/identifier", identifier]] : []),
        ]),
        allowsNostr: true,
        nostrPubkey: storePubkey,
      },
      { headers: LNURL_HEADERS },
    );
  }

  const nostrParam = url.searchParams.get("nostr");
  if (!nostrParam) {
    return lnurlError("Este endpoint requiere un zap request NIP-57 firmado");
  }

  let signed: SignedZapRequest;
  try {
    signed = JSON.parse(nostrParam) as SignedZapRequest;
  } catch {
    return lnurlError("Zap request invalido");
  }
  if (nip57.validateZapRequest(JSON.stringify(signed))) {
    return lnurlError("Zap request invalido");
  }

  const anchorEventId = tagValue(signed, "e");
  if (!anchorEventId) {
    return lnurlError("El zap debe apuntar al contrato de una apuesta");
  }

  const bet = await prisma.zapBet.findUnique({
    where: { anchorEventId },
    include: { participants: true },
  });
  if (!bet) return lnurlError("Contrato de apuesta no encontrado");

  const part = bet.participants.find((candidate) => candidate.pubkey === signed.pubkey);
  if (!part) return lnurlError("El firmante no participa de esta apuesta");

  const open =
    bet.status === "pending_deposits" &&
    (bet.depositDeadline == null || bet.depositDeadline > new Date());
  if (!open) return lnurlError("El deposito esta cerrado");
  if (part.depositStatus === "paid") return lnurlError("Ya depositaste");
  if (Number(amount) !== Number(bet.stakeMsat)) {
    return lnurlError(`Monto debe ser exactamente ${bet.stakeMsat} msat`);
  }

  const validation = validateDepositZapRequest(bet, part, signed, baseUrl);
  if (!validation.ok) return lnurlError(validation.error);

  try {
    const invoice = await ensureDepositInvoiceV2(bet, part, signed);
    return NextResponse.json(
      { pr: invoice.invoice, routes: [] },
      { headers: LNURL_HEADERS },
    );
  } catch (error) {
    await notifyOperationalError({
      source: "lnurl-store-deposit-invoice",
      error,
      fingerprint: `lnurl-store-deposit-invoice:${part.id}`,
      context: { betId: bet.id, participantId: part.id, amountMsat: amount },
    });
    return lnurlError(
      error instanceof Error ? error.message : "No se pudo generar el invoice",
    );
  }
}
