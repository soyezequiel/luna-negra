import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { computeEconomics, publicBetStatus } from "@/lib/escrow-math";
import { ensureDepositInvoice } from "@/lib/escrow-deposit";
import { checkAndSettleDeposit } from "@/lib/escrow-tick";
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

// Anti-rebote del lookup de invoice por participante: el consumidor de la API
// (un juego) puede pollear este GET cada <1 s y con varios clientes a la vez, y
// cada checkAndSettleDeposit hace un lookup_invoice por NWC sobre el relay. Sin
// esto martillaríamos el wallet. 1,5 s mantiene la detección casi inmediata sin
// disparar una consulta al relay por cada request. (Caché por instancia; bajo
// ráfaga degrada a más consultas, nunca a un resultado incorrecto.)
const ONDEMAND_CHECK_MIN_MS = 1500;
const lastDepositCheckAt = new Map<string, number>();

async function checkPendingDepositsThrottled(
  participantIds: string[],
): Promise<boolean> {
  const now = Date.now();
  const due = participantIds.filter((id) => {
    if (now - (lastDepositCheckAt.get(id) ?? 0) < ONDEMAND_CHECK_MIN_MS) return false;
    lastDepositCheckAt.set(id, now);
    return true;
  });
  // En paralelo: cada checkAndSettleDeposit hace un lookup_invoice por NWC y es
  // idempotente (settleDeposit usa idempotencyKey en el ledger y promoteIfAllPaid
  // un claim optimista), así que correr los participantes a la vez no duplica
  // depósitos ni dobles transiciones, y el poll responde más rápido.
  const settled = await Promise.all(due.map((id) => checkAndSettleDeposit(id)));
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
  let bet = await prisma.bet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);
  if (bet.providerId !== providerId) {
    return apiError("NOT_BET_OWNER", "La apuesta no es de tu proveedor", 403);
  }

  // Detección on-demand para consumidores de la API de proveedor (p. ej. un juego
  // que postea el estado de la apuesta a sus jugadores): verificamos los invoices
  // pendientes ya mismo en vez de esperar al tick de ~1 min. Sin esto, el pago del
  // QR solo se detecta cuando alguien abre la web propia de Luna. Esto settlea el
  // depósito y dispara los webhooks (deposit.received / bet.funded) al instante.
  if (bet.status === "pending_deposits") {
    const pending = bet.participants
      .filter((p) => p.depositStatus === "pending")
      .map((p) => p.id);
    if (await checkPendingDepositsThrottled(pending)) {
      bet = (await prisma.bet.findUnique({
        where: { id },
        include: { participants: true },
      }))!;
    }
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

  // Generamos los handles de pago de todos los participantes EN PARALELO: cada
  // ensureDepositInvoice hace un make_invoice por NWC (~2-4 s sobre el relay) y, en
  // serie, el primer GET tras crear la apuesta tardaba N×3 s (el host esperaba
  // ~10 s con varios jugadores). El cliente NWC cacheado correlaciona request/
  // response por evento, así que los make_invoice concurrentes son seguros.
  // Promise.all preserva el orden; cada participante falla de forma aislada.
  const participants = await Promise.all(
    bet.participants.map(async (p) => {
      // Handles de pago: solo se generan/exponen mientras el depósito esté abierto y
      // el participante no haya pagado; si no, van null (= depósito cerrado).
      let bolt11: string | null = null;
      let lnurl: string | null = null;
      let payUrl: string | null = null;
      let depositError: string | null = null;
      if (open && p.depositStatus === "pending") {
        // Best-effort por participante: si generar el invoice falla (p. ej. NWC sin
        // permiso make-invoice, budget agotado o relay caído), NO tumbamos toda la
        // respuesta — el resto sigue con sus handles y este participante queda con
        // null + `depositError`. La respuesta es `no-store`, así que el siguiente poll
        // reintenta. Logueamos el motivo real (antes un fallo acá daba un 500 opaco y
        // el consumidor de la API se quedaba sin métodos de pago ni explicación).
        try {
          const inv = await ensureDepositInvoice(bet, p);
          bolt11 = inv.invoice;
          lnurl = encodeLnurl(`${base}/api/escrow/lnurlp/${p.id}`);
          payUrl = `${base}/bets/${bet.id}`;
        } catch (e) {
          depositError =
            e instanceof Error ? e.message : "No se pudo generar el invoice de depósito.";
          console.error(
            `[bets/${bet.id}] ensureDepositInvoice falló para participante ${p.id}:`,
            e,
          );
        }
      }
      return {
        npub: p.npub,
        depositStatus: p.depositStatus, // pending | paid | refunded | failed
        result: p.result, // pending | won | lost | tie
        payoutStatus: p.payoutStatus,
        payoutSats: p.payoutMsat != null ? sats(p.payoutMsat) : null,
        bolt11,
        lnurl,
        payUrl,
        depositError,
      };
    }),
  );

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
