import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import { payParticipant } from "@/lib/escrow-payout";
import { emitBetCancelled, emitBetRefunded } from "@/lib/webhooks";
import { apiOk, apiError, corsPreflight } from "@/lib/api";
import { betsV1Gone } from "@/lib/bets-v1-gate";

// Cancela una apuesta NO resuelta (Bearer API key del proveedor dueño) y
// reembolsa los depósitos ya confirmados. El pozo queda reconciliado: cada
// depósito settled se devuelve a su dueño.
export function OPTIONS() {
  return corsPreflight();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gone = betsV1Gone();
  if (gone) return gone;
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
  if (bet.status === "settled" || bet.status === "voided") {
    return apiError("ALREADY_RESOLVED", "La apuesta ya se resolvió", 409);
  }

  // Claim optimista: solo se cancela desde pending_deposits o ready (no en medio
  // de un settling/refunding ni ya terminal). Gana un solo request la carrera.
  const claimed = await prisma.bet.updateMany({
    where: { id, status: { in: ["pending_deposits", "ready"] } },
    data: { status: "refunding" },
  });
  if (claimed.count !== 1) {
    return apiError(
      "CANNOT_CANCEL",
      "La apuesta no se puede cancelar en su estado actual",
      409,
    );
  }

  // Reembolsar a todos los que ya depositaron (idempotente vía ledger).
  for (const p of bet.participants.filter((x) => x.depositStatus === "paid")) {
    await payParticipant({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
  }
  await prisma.bet.update({ where: { id }, data: { status: "cancelled_admin" } });

  after(async () => {
    await emitBetCancelled(id);
    await emitBetRefunded(id, "cancelled");
  });
  return apiOk({ ok: true, status: "cancelled" });
}
