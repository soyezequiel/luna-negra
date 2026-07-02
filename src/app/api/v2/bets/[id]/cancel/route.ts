import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { payParticipantV2 } from "@/lib/escrow-v2-payout";
import { emitBetCancelledV2, emitBetRefundedV2 } from "@/lib/webhooks";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";

// Cancela una apuesta v2 NO resuelta (Bearer API key del proveedor dueño) y
// reembolsa por zap los depósitos ya confirmados. Espejo del cancel v1.
export function OPTIONS() {
  return corsPreflight();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!BETS_V2_ENABLED) {
    return apiError("BETS_V2_DISABLED", "Las apuestas v2 están desactivadas", 503);
  }
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);
  }

  const { id } = await params;
  const bet = await prisma.zapBet.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!bet) return apiError("BET_NOT_FOUND", "Apuesta no encontrada", 404);
  if (bet.providerId !== providerId) {
    return apiError("NOT_BET_OWNER", "La apuesta no es de tu proveedor", 403);
  }
  if (bet.status === "settled" || bet.status === "voided") {
    return apiError("ALREADY_RESOLVED", "La apuesta ya se resolvió", 409);
  }

  const claimed = await prisma.zapBet.updateMany({
    where: { id, status: { in: ["pending_deposits", "ready"] } },
    data: { status: "refunding" },
  });
  if (claimed.count !== 1) {
    return apiError("CANNOT_CANCEL", "La apuesta no se puede cancelar en su estado actual", 409);
  }

  for (const p of bet.participants.filter((x) => x.depositStatus === "paid")) {
    await payParticipantV2({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
  }
  await prisma.zapBet.update({ where: { id }, data: { status: "cancelled_admin" } });

  after(async () => {
    await emitBetCancelledV2(id);
    await emitBetRefundedV2(id, "cancelled");
  });
  return apiOk({ ok: true, status: "cancelled" });
}
