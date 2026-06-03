import type { Bet, BetParticipant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchProfile } from "@/lib/nostr";
import { pubkeyFromNpub } from "@/lib/escrow";
import { recordOutflow } from "@/lib/ledger";
import { msatToSats } from "@/lib/money";
import {
  lightningConfigured,
  payToLightningAddress,
} from "@/lib/lightning";
import { WITHDRAW_WINDOW_MS } from "@/lib/escrow-config";

/** Cascada de destino (R5): por ahora lud16 del perfil Nostr (kind:0). */
export async function resolveDestination(npub: string): Promise<string | null> {
  const pk = pubkeyFromNpub(npub);
  if (!pk) return null;
  const profile = await fetchProfile(pk).catch(() => null);
  return profile?.lud16 ?? null;
}

/**
 * Mueve plata a un participante (reembolso o payout). Idempotente vía ledger.
 * - registra el outflow (invariante anti-insolvencia),
 * - resuelve destino (lud16) y paga; si no hay destino → withdraw_pending (QR, M6),
 * - en dev sin NWC, simula el pago.
 */
export async function payParticipant(args: {
  bet: Bet;
  participant: BetParticipant;
  amountMsat: bigint;
  kind: "refund" | "payout";
}): Promise<void> {
  const { bet, participant, amountMsat, kind } = args;
  const idempotencyKey = `${kind}:${bet.id}:${participant.userId}`;

  const rec = await recordOutflow({
    betId: bet.id,
    userId: participant.userId,
    kind,
    amountMsat,
    idempotencyKey,
  });
  if (!rec.ok) return; // duplicate (ya procesado) o insolvent (no debería)

  const dest = await resolveDestination(participant.npub);

  const markPaid = async (preimage: string) => {
    await prisma.ledgerEntry.update({
      where: { idempotencyKey },
      data: { status: "settled", paymentHash: preimage },
    });
    await prisma.betParticipant.update({
      where: { id: participant.id },
      data: {
        payoutStatus: "paid",
        payoutMsat: amountMsat,
        payoutDestination: dest,
        settledAt: new Date(),
        ...(kind === "refund" ? { depositStatus: "refunded" } : {}),
      },
    });
  };
  const markFailed = async () => {
    await prisma.ledgerEntry.update({
      where: { idempotencyKey },
      data: { status: "failed" },
    });
    await prisma.betParticipant.update({
      where: { id: participant.id },
      data: { payoutStatus: "failed", payoutMsat: amountMsat },
    });
  };

  // Dev sin wallet: simular pago para poder probar el flujo.
  if (!lightningConfigured()) {
    await markPaid("dev-preimage");
    return;
  }

  if (!dest) {
    // Sin destino → retiro por QR (M6). El ledger queda pending (comprometido).
    await prisma.betParticipant.update({
      where: { id: participant.id },
      data: {
        payoutStatus: "withdraw_pending",
        payoutMsat: amountMsat,
        withdrawDeadline: new Date(Date.now() + WITHDRAW_WINDOW_MS),
      },
    });
    return;
  }

  try {
    const preimage = await payToLightningAddress(
      dest,
      Number(msatToSats(amountMsat)),
      `Luna Negra ${kind} ${bet.id}`,
    );
    await markPaid(preimage);
  } catch {
    await markFailed();
  }
}
