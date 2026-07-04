import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { computeEconomics, publicBetStatus } from "@/lib/escrow-math";
import {
  checkAndSettleDepositV2,
  participantLnurlUrl,
  buildDepositZapRequest,
  buildParticipationComment,
  ensureCustodialDepositInvoiceV2,
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
    include: {
      participants: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { nsecEnc: true } } },
      },
    },
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
        include: {
      participants: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { nsecEnc: true } } },
      },
    },
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

  // Handles de depósito por participante. Cada asiento se resuelve de forma aislada
  // (best-effort): si falla el de uno, el resto igual responde con los suyos. En
  // paralelo porque los invitados hacen un make_invoice por NWC (~2-4 s c/u).
  const participants = await Promise.all(
    bet.participants.map(async (p) => {
      // El depósito v2 SIEMPRE es un zap NIP-57 anclado al contrato: hay que firmar un
      // 9734 y recién ahí sale el invoice. Según quién tenga la clave:
      //   - INVITADO/custodial (Luna guarda su `nsecEnc`): Luna firma el 9734 en su
      //     nombre y emite el invoice ya mismo → devolvemos `bolt11`, y el jugador
      //     paga con cualquier wallet/extensión/QR (sin firmar nada).
      //   - CLAVE PROPIA (NIP-07/46): mandamos el 9734 SIN firmar (`depositZapRequest`)
      //     + su `depositCallback`; el juego lo firma con la identidad del jugador.
      //   - `bolt11` ya emitido (firma previa): persiste el QR entre polls.
      //   - `lnurl`/`payUrl`: se mantienen (QR NIP-57 y firma en la web de Luna).
      const canDeposit = open && p.depositStatus === "pending";
      const lnurl = canDeposit ? encodeLnurl(participantLnurlUrl(base, p.id)) : null;
      const payUrl = canDeposit ? `${base}/apuestas/${bet.id}` : null;
      let bolt11 = canDeposit ? p.depositInvoice : null;
      let depositZapRequest: ReturnType<typeof buildDepositZapRequest> | null = null;
      let depositCallback: string | null = null;
      let participationComment: ReturnType<typeof buildParticipationComment> = null;
      let commentCallback: string | null = null;
      let depositError: string | null = null;

      if (canDeposit && !bolt11) {
        // 1) Invitado/custodial: Luna firma y emite el invoice (best-effort).
        try {
          const inv = await ensureCustodialDepositInvoiceV2(bet, p, base);
          if (inv) bolt11 = inv.invoice;
        } catch (e) {
          depositError =
            e instanceof Error ? e.message : "No se pudo generar el invoice de depósito.";
          console.error(
            `[v2/bets/${bet.id}] depósito custodial falló para ${p.id}:`,
            e,
          );
        }
        // 2) Clave propia: el 9734 sin firmar para que el cliente lo firme.
        if (!bolt11) {
          try {
            depositZapRequest = buildDepositZapRequest(bet, p, base);
            depositCallback = participantLnurlUrl(base, p.id);
            // Comentario de participación (kind:1 reply al contrato) para que el
            // juego lo firme junto al 9734 y lo mande a `commentCallback`. Si gana,
            // el premio se zapea a ESTE comentario en vez del post del contrato.
            // Opcional: sin él, el flujo de depósito funciona igual.
            participationComment = buildParticipationComment(bet);
            commentCallback = participationComment
              ? `${base}/api/v2/bets/${bet.id}/comment`
              : null;
          } catch {
            // Sin identidad de tienda / ancla no se puede armar el zap request; el
            // juego cae al fallback `payUrl`. No tumbamos al resto de asientos.
            depositZapRequest = null;
            depositCallback = null;
            participationComment = null;
            commentCallback = null;
          }
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
        participationComment,
        commentCallback,
        depositError,
        result: p.result,
        payoutStatus: p.payoutStatus,
        payoutSats: p.payoutMsat != null ? sats(p.payoutMsat) : null,
        payoutKind: p.payoutKind,
        payoutReceiptId: p.payoutReceiptId,
      };
    }),
  );

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
