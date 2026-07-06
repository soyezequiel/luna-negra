import { prisma } from "./prisma";
import { computeEconomics } from "./escrow-math";
import { msatToSats } from "./money";
import { BET_FEE_MIN_MSAT } from "./escrow-v2-config";

/**
 * Cuerpo de respuesta de "crear apuesta v2" a partir de una `zapBet` ya creada.
 * Es el MISMO shape que devuelve `POST /api/v2/bets` (betId, economía, handles de
 * asiento), extraído para que el camino NGP `POST /api/v2/bets/from-contract`
 * —que materializa la apuesta desde un contrato 1339 en vez de crearla por API—
 * devuelva exactamente lo que el juego ya sabe consumir. Devuelve null si la
 * apuesta no existe.
 */
export async function buildBetCreateBody(
  betId: string,
): Promise<Record<string, unknown> | null> {
  const bet = await prisma.zapBet.findUnique({
    where: { id: betId },
    include: {
      participants: {
        orderBy: { createdAt: "asc" },
        select: { id: true, npub: true },
      },
    },
  });
  if (!bet) return null;

  const econ = computeEconomics({
    stakeMsat: bet.stakeMsat,
    participantCount: bet.participants.length,
    feePct: bet.feePct,
    devFeePct: bet.devFeePct,
    feeMinMsat: BET_FEE_MIN_MSAT,
  });

  return {
    betId: bet.id,
    apiVersion: 2,
    anchorEventId: bet.anchorEventId,
    depositDeadline: bet.depositDeadline?.toISOString() ?? null,
    stakeSats: Number(msatToSats(bet.stakeMsat)),
    potTargetSats: Number(msatToSats(econ.potMsat)),
    feePct: bet.feePct,
    feeBps: econ.feeBps,
    feeSats: Number(msatToSats(econ.feeMsat)),
    devFeePct: bet.devFeePct,
    devFeeBps: econ.devFeeBps,
    devFeeSats: Number(msatToSats(econ.devFeeMsat)),
    netPayoutSats: Number(msatToSats(econ.netMsat)),
    roomId: bet.roomId,
    metadata: bet.metadataJson ? JSON.parse(bet.metadataJson) : null,
    participants: bet.participants.map((p, i) => ({
      seat: i + 1,
      npub: p.npub,
      participantId: p.id,
    })),
  };
}
