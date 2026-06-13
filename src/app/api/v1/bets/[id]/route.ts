import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { computeEconomics, publicBetStatus } from "@/lib/escrow-math";
import { ensureDepositInvoice } from "@/lib/escrow-deposit";
import { encodeLnurl } from "@/lib/lnurl";
import { msatToSats } from "@/lib/money";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Estado + economía + handles de pago de una apuesta, en una sola llamada
// (Bearer API key del proveedor dueño). Incluye, por participante, cómo deposita
// su stake (bolt11/lnurl/payUrl) mientras el depósito siga abierto.
export function OPTIONS() {
  return corsPreflight();
}

function baseUrl(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
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
  const bet = await prisma.bet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);
  if (bet.providerId !== providerId) {
    return apiError("NOT_BET_OWNER", "La apuesta no es de tu proveedor", 403);
  }

  const sats = (msat: bigint) => Number(msatToSats(msat));
  const econ = computeEconomics({
    stakeMsat: bet.stakeMsat,
    participantCount: bet.participants.length,
    feePct: bet.feePct,
  });
  const paidCount = bet.participants.filter((p) => p.depositStatus === "paid").length;

  // El depósito sigue abierto solo mientras la apuesta junta plata y no venció el plazo.
  const open =
    bet.status === "pending_deposits" &&
    (bet.depositDeadline == null || bet.depositDeadline > new Date());
  const base = baseUrl(req);

  const participants = [];
  for (const p of bet.participants) {
    // Handles de pago: solo se generan/exponen mientras el depósito esté abierto y
    // el participante no haya pagado; si no, van null (= depósito cerrado).
    let bolt11: string | null = null;
    let lnurl: string | null = null;
    let payUrl: string | null = null;
    if (open && p.depositStatus === "pending") {
      const inv = await ensureDepositInvoice(bet, p);
      bolt11 = inv.invoice;
      lnurl = encodeLnurl(`${base}/api/escrow/lnurlp/${p.id}`);
      payUrl = `${base}/bets/${bet.id}`;
    }
    participants.push({
      npub: p.npub,
      depositStatus: p.depositStatus, // pending | paid | refunded | failed
      result: p.result, // pending | won | lost | tie
      payoutStatus: p.payoutStatus,
      payoutSats: p.payoutMsat != null ? sats(p.payoutMsat) : null,
      bolt11,
      lnurl,
      payUrl,
    });
  }

  return apiOk(
    {
      betId: bet.id,
      gameId: bet.gameId,
      status: publicBetStatus(bet.status),
      victoryCondition: bet.victoryCondition,
      depositDeadline: bet.depositDeadline?.toISOString() ?? null,
      resolveDeadline: bet.resolveDeadline?.toISOString() ?? null,
      stakeSats: sats(bet.stakeMsat),
      potSats: sats(bet.stakeMsat) * paidCount, // depositado hasta ahora
      potTargetSats: sats(econ.potMsat), // pozo cuando esté completo
      depositsReceived: paidCount,
      depositsTotal: bet.participants.length,
      feePct: bet.feePct,
      feeBps: econ.feeBps,
      feeSats: sats(econ.feeMsat),
      netPayoutSats: sats(econ.netMsat),
      participants,
      roomId: bet.roomId,
      metadata: bet.metadataJson ? JSON.parse(bet.metadataJson) : null,
      contractEventId: bet.contractEventId,
      resultEventId: bet.resultEventId,
    },
    { "Cache-Control": "no-store" },
  );
}
