import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { msatToSats } from "@/lib/money";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { publicBetStatus } from "@/lib/escrow-math";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";

// Radiografía TEMPORAL de una apuesta v2, pensada para diagnosticar "por qué tardó
// el pago". Devuelve los timestamps crudos que persistimos (creación, fondeo,
// liquidación; por participante: depósito y payout; y cada asiento del ledger) MÁS
// las duraciones por fase ya calculadas. La consume el botón "Reportar problema"
// del juego (vía su backend, que tiene la API key) para adjuntar el desglose al
// reporte de Discord. Es de solo lectura y no toca Lightning ni Nostr.
export function OPTIONS() {
  return corsPreflight();
}

const sats = (msat: bigint | null | undefined): number | null =>
  msat == null ? null : Number(msatToSats(msat));

// Diferencia en ms entre dos fechas (o null si falta alguna). Nunca negativa: si el
// orden se invierte por skew de reloj, devolvemos 0 en vez de un número engañoso.
const diffMs = (from: Date | null, to: Date | null): number | null => {
  if (!from || !to) return null;
  return Math.max(0, to.getTime() - from.getTime());
};

const iso = (d: Date | null | undefined): string | null => d?.toISOString() ?? null;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!BETS_V2_ENABLED) {
    return apiError("BETS_V2_DISABLED", "Las apuestas v2 están desactivadas", 503);
  }
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError(
      "INVALID_API_KEY",
      "API key inválida (Authorization: Bearer ln_sk_…)",
      401,
    );
  }

  const { id } = await params;
  const bet = await prisma.zapBet.findUnique({
    where: { id },
    include: {
      participants: { orderBy: { createdAt: "asc" } },
      ledger: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);
  if (bet.providerId !== providerId) {
    return apiError("NOT_BET_OWNER", "La apuesta no es de tu proveedor", 403);
  }

  // Fases macro del ciclo de vida (lo que se siente como "tardanza"):
  //  - funding:    crear → juntar todos los depósitos (readyAt).
  //  - settlement: fondeada → premio pagado y todo asentado (settledAt).
  //  - total:      crear → settled.
  const phases = {
    fundingMs: diffMs(bet.createdAt, bet.readyAt),
    settlementMs: diffMs(bet.readyAt, bet.settledAt),
    totalMs: diffMs(bet.createdAt, bet.settledAt),
  };

  const participants = bet.participants.map((p, i) => ({
    seat: i + 1,
    npub: p.npub,
    createdAt: iso(p.createdAt),
    deposit: {
      status: p.depositStatus,
      paidAt: iso(p.paidAt),
      // Cuánto pasó desde que se creó la apuesta hasta que se detectó SU depósito.
      sinceCreateMs: diffMs(bet.createdAt, p.paidAt),
      receiptOk: p.depositReceiptOk,
    },
    result: p.result,
    payout: {
      status: p.payoutStatus,
      kind: p.payoutKind,
      sats: sats(p.payoutMsat),
      settledAt: iso(p.settledAt),
      // Cuánto pasó entre "fondeada" (listo para resolver) y que SU premio quedó
      // pagado: el corazón del "tarda en pagar al ganador".
      sinceReadyMs: diffMs(bet.readyAt, p.settledAt),
    },
  }));

  // Asientos del ledger con el desfase desde readyAt: revela la SERIALIZACIÓN de la
  // liquidación (fee, payout del ganador, dev_fee salen uno tras otro). Si un asiento
  // aparece mucho después de readyAt, ahí se fue el tiempo.
  const ledger = bet.ledger.map((e) => ({
    kind: e.kind,
    status: e.status,
    sats: sats(e.amountMsat),
    createdAt: iso(e.createdAt),
    sinceReadyMs: diffMs(bet.readyAt, e.createdAt),
  }));

  return apiOk(
    {
      betId: bet.id,
      apiVersion: 2,
      status: publicBetStatus(bet.status),
      rawStatus: bet.status,
      generatedAt: new Date().toISOString(),
      bet: {
        createdAt: iso(bet.createdAt),
        depositDeadline: iso(bet.depositDeadline),
        readyAt: iso(bet.readyAt),
        resolveDeadline: iso(bet.resolveDeadline),
        settledAt: iso(bet.settledAt),
        hasAnchor: Boolean(bet.anchorEventId && !bet.anchorEventId.startsWith("dev-anchor-")),
        hasResultEvent: Boolean(bet.resultEventId),
        hasSettleNote: Boolean(bet.settleNoteId),
      },
      phases,
      participants,
      ledger,
    },
    { "Cache-Control": "no-store" },
  );
}
