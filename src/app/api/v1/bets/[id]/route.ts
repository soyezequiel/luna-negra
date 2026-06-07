import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { computeEconomics, publicBetStatus } from "@/lib/escrow-math";
import { msatToSats } from "@/lib/money";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Estado de una apuesta para el game server (Bearer API key del proveedor dueño).
export function OPTIONS() {
  return corsPreflight();
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
  const paid = bet.participants.filter((p) => p.depositStatus === "paid");

  return apiOk({
    betId: bet.id,
    gameId: bet.gameId,
    status: publicBetStatus(bet.status),
    victoryCondition: bet.victoryCondition,
    depositDeadline: bet.depositDeadline?.toISOString() ?? null,
    resolveDeadline: bet.resolveDeadline?.toISOString() ?? null,
    stakeSats: sats(bet.stakeMsat),
    potSats: sats(bet.stakeMsat) * paid.length, // depositado hasta ahora
    potTargetSats: sats(econ.potMsat), // pozo cuando esté completo
    feePct: bet.feePct,
    feeBps: econ.feeBps,
    feeSats: sats(econ.feeMsat),
    netPayoutSats: sats(econ.netMsat),
    participants: bet.participants.map((p) => ({
      npub: p.npub,
      depositStatus: p.depositStatus, // pending | paid | refunded | failed
      result: p.result, // pending | won | lost | tie
      payoutStatus: p.payoutStatus,
      payoutSats: p.payoutMsat != null ? sats(p.payoutMsat) : null,
    })),
    roomId: bet.roomId,
    metadata: bet.metadataJson ? JSON.parse(bet.metadataJson) : null,
    contractEventId: bet.contractEventId,
    resultEventId: bet.resultEventId,
  });
}
