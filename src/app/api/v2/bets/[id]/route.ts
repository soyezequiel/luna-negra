import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { computeEconomics, publicBetStatus } from "@/lib/escrow-math";
import {
  checkAndSettleDepositV2,
  participantLnurlUrl,
  buildDepositZapRequest,
} from "@/lib/zap-bet";
import { encodeLnurl } from "@/lib/zap";
import { msatToSats } from "@/lib/money";
import { BET_FEE_MIN_MSAT } from "@/lib/escrow-v2-config";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { siteUrl } from "@/lib/site-url";

// Estado + economía + handles de depósito por zap de una apuesta v2 (Bearer API
// key del proveedor). En cada poll de un participante pendiente verifica el
// invoice on-demand (detección en segundos, como v1) y, si pagó, publica el 9735.
export function OPTIONS() {
  return corsPreflight();
}

// Anti-rebote del lookup de invoice por participante (idéntico a v1): cada
// checkAndSettleDepositV2 hace un lookup_invoice por NWC; sin throttle un poll
// agresivo martillaría el wallet. 1,5 s mantiene la detección casi inmediata.
const ONDEMAND_CHECK_MIN_MS = 1500;
const lastDepositCheckAt = new Map<string, number>();

async function checkPendingDepositsThrottled(participantIds: string[]): Promise<boolean> {
  const now = Date.now();
  const due = participantIds.filter((id) => {
    if (now - (lastDepositCheckAt.get(id) ?? 0) < ONDEMAND_CHECK_MIN_MS) return false;
    lastDepositCheckAt.set(id, now);
    return true;
  });
  const settled = await Promise.all(due.map((id) => checkAndSettleDepositV2(id)));
  return settled.some(Boolean);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError(
      "INVALID_API_KEY",
      "API key inválida (Authorization: Bearer ln_sk_…)",
      401,
    );
  }

  const { id } = await params;
  let bet = await prisma.zapBet.findUnique({
    where: { id },
    include: { participants: { orderBy: { createdAt: "asc" } } },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);
  if (bet.providerId !== providerId) {
    return apiError("NOT_BET_OWNER", "La apuesta no es de tu proveedor", 403);
  }

  // Detección on-demand: verificamos los depósitos pendientes ya mismo en vez de
  // esperar al tick. Settlea + publica el 9735 + dispara webhooks al instante.
  if (bet.status === "pending_deposits") {
    const pending = bet.participants
      .filter((p) => p.depositStatus === "pending")
      .map((p) => p.id);
    if (await checkPendingDepositsThrottled(pending)) {
      bet = (await prisma.zapBet.findUnique({
        where: { id },
        include: { participants: { orderBy: { createdAt: "asc" } } },
      }))!;
    }
  }

  const sats = (msat: bigint) => Number(msatToSats(msat));
  const econ = computeEconomics({
    stakeMsat: bet.stakeMsat,
    participantCount: bet.participants.length,
    feePct: bet.feePct,
    devFeePct: bet.devFeePct,
    feeMinMsat: BET_FEE_MIN_MSAT,
  });
  const paidCount = bet.participants.filter((p) => p.depositStatus === "paid").length;

  const open =
    bet.status === "pending_deposits" &&
    (bet.depositDeadline == null || bet.depositDeadline > new Date());
  // URL canónica (NEXT_PUBLIC_SITE_URL, https): el LNURL de depósito y el payUrl
  // deben ser https y del dominio público, o las wallets rechazan el LNURL. Detrás
  // del proxy los headers pueden dar http/host interno, así que NO los usamos.
  const base = siteUrl(req);

  const participants = bet.participants.map((p) => {
    // El depósito v2 SIEMPRE es un zap NIP-57: el apostador firma un 9734 anclado al
    // contrato y recién ahí sale el invoice. Para que un consumidor de la API (un
    // juego con el firmante Nostr del jugador) pueda hacer que "pagar con extensión"
    // y el QR sean zaps reales —no un LNURL-pay plano que el callback rechaza— le
    // damos todo lo necesario para completar el zap fuera de la web de Luna:
    //   - `depositZapRequest`: el 9734 SIN firmar (mismos tags que valida el callback);
    //     el juego lo firma con la identidad del jugador.
    //   - `depositCallback`: a dónde mandar el 9734 firmado (`?amount&nostr`) para
    //     obtener el invoice. Es el LNURL-pay del participante.
    //   - `bolt11`: el invoice ya emitido (si el jugador ya firmó en un intento
    //     previo); así el QR persiste entre polls y el que vuelve paga el mismo.
    //   - `lnurl`/`payUrl`: se mantienen (QR LNURL para wallets con NIP-57 y firma
    //     en la web de Luna como fallback).
    const canDeposit = open && p.depositStatus === "pending";
    const lnurl = canDeposit ? encodeLnurl(participantLnurlUrl(base, p.id)) : null;
    const payUrl = canDeposit ? `${base}/apuestas/${bet.id}` : null;
    const bolt11 = canDeposit ? p.depositInvoice : null;
    // El 9734 sin firmar solo hace falta mientras no haya invoice emitido todavía.
    let depositZapRequest: ReturnType<typeof buildDepositZapRequest> | null = null;
    let depositCallback: string | null = null;
    if (canDeposit && !bolt11) {
      try {
        depositZapRequest = buildDepositZapRequest(bet, p, base);
        depositCallback = participantLnurlUrl(base, p.id);
      } catch {
        // Sin identidad de tienda / ancla no se puede armar el zap request; el juego
        // cae al fallback `payUrl`. No tumbamos la respuesta del resto de asientos.
        depositZapRequest = null;
        depositCallback = null;
      }
    }
    return {
      participantId: p.id,
      npub: p.npub,
      depositStatus: p.depositStatus,
      depositReceiptId: p.depositReceiptId,
      bolt11,
      lnurl,
      payUrl,
      depositZapRequest,
      depositCallback,
      result: p.result,
      payoutStatus: p.payoutStatus,
      payoutSats: p.payoutMsat != null ? sats(p.payoutMsat) : null,
      payoutKind: p.payoutKind,
      payoutReceiptId: p.payoutReceiptId,
    };
  });

  return apiOk(
    {
      betId: bet.id,
      apiVersion: 2,
      gameId: bet.gameId,
      status: publicBetStatus(bet.status),
      victoryCondition: bet.victoryCondition,
      depositDeadline: bet.depositDeadline?.toISOString() ?? null,
      resolveDeadline: bet.resolveDeadline?.toISOString() ?? null,
      stakeSats: sats(bet.stakeMsat),
      potSats: sats(bet.stakeMsat) * paidCount,
      potTargetSats: sats(econ.potMsat),
      depositsReceived: paidCount,
      depositsTotal: bet.participants.length,
      feePct: bet.feePct,
      feeBps: econ.feeBps,
      feeSats: sats(econ.feeMsat),
      devFeePct: bet.devFeePct,
      devFeeBps: econ.devFeeBps,
      devFeeSats: sats(econ.devFeeMsat),
      netPayoutSats: sats(econ.netMsat),
      participants,
      roomId: bet.roomId,
      metadata: bet.metadataJson ? JSON.parse(bet.metadataJson) : null,
      anchorEventId: bet.anchorEventId,
      resultEventId: bet.resultEventId,
      settleNoteId: bet.settleNoteId,
    },
    { "Cache-Control": "no-store" },
  );
}
