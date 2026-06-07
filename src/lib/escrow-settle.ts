import { after } from "next/server";
import type { Event } from "nostr-tools";
import type { Bet, BetParticipant, Provider, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordOutflow } from "@/lib/ledger";
import { computeContractHash } from "@/lib/escrow";
import { computeEconomics, splitWinnings } from "@/lib/escrow-math";
import { payParticipant } from "@/lib/escrow-payout";
import { publishSignedEvent } from "@/lib/nostr-server";
import { emitBetSettled, emitBetRefunded } from "@/lib/webhooks";

export type BetWithRelations = Bet & {
  provider: Provider & { owner: User };
  participants: BetParticipant[];
};

export type SettleResult =
  | { ok: true; voided?: boolean }
  | { ok: false; code: string; message: string; status: number };

/**
 * Núcleo de liquidación de una apuesta. Es idéntico para los dos caminos de
 * reporte de resultado (evento Nostr firmado por el proveedor, o API key con
 * Luna Negra firmando con el oráculo gestionado): ambos construyen un evento de
 * resultado firmado y la lista de npubs ganadores, y delegan acá.
 *
 * Invariantes de escrow (NO tocar): claim de carrera `ready → settling`,
 * verificación del hash del contrato antes de pagar, idempotencia vía estado,
 * pagos = pozo − fee, anulación = reembolso total sin fee.
 *
 * `resultEvent` ya debe estar firmado y verificado por el caller; acá solo se
 * republica (prueba en Nostr) y se guarda su id.
 */
export async function settleBetWithResult(args: {
  bet: BetWithRelations;
  winnerNpubs: string[];
  resultEvent: Event;
}): Promise<SettleResult> {
  const { bet, winnerNpubs, resultEvent } = args;
  const betId = bet.id;

  if (bet.status === "settled") {
    return { ok: false, code: "ALREADY_RESOLVED", message: "Ya resuelta", status: 409 };
  }
  if (
    ["cancelled_incomplete", "cancelled_admin", "refunded_timeout"].includes(
      bet.status,
    )
  ) {
    return {
      ok: false,
      code: "TOO_LATE",
      message: "La apuesta ya fue reembolsada/cancelada",
      status: 410,
    };
  }

  // Claim ready → settling (solo un request gana la carrera).
  const claimed = await prisma.bet.updateMany({
    where: { id: betId, status: "ready" },
    data: { status: "settling" },
  });
  if (claimed.count !== 1) {
    return {
      ok: false,
      code: "NOT_READY",
      message: "La apuesta no está lista para resolver",
      status: 409,
    };
  }

  // Integridad: los términos vivos deben coincidir con el contrato firmado.
  if (bet.contractHash) {
    const liveHash = computeContractHash({
      betId: bet.id,
      gameId: bet.gameId,
      stakeMsat: bet.stakeMsat,
      feePct: bet.feePct,
      victoryCondition: bet.victoryCondition,
      npubs: bet.participants.map((p) => p.npub),
    });
    if (liveHash !== bet.contractHash) {
      await prisma.bet.updateMany({
        where: { id: betId, status: "settling" },
        data: { status: "ready" },
      });
      console.error(
        `[escrow] términos alterados en ${betId}: contrato=${bet.contractHash} vivo=${liveHash}`,
      );
      return {
        ok: false,
        code: "CONTRACT_MISMATCH",
        message: "Los términos no coinciden con el contrato firmado; no se paga",
        status: 409,
      };
    }
  }

  // Ganadores declarados que sean participantes.
  const winners = bet.participants.filter((p) => winnerNpubs.includes(p.npub));

  // Sin ganadores válidos ⇒ empate/anulación ⇒ reembolso total a TODOS (sin fee).
  if (winners.length === 0) {
    for (const p of bet.participants) {
      await prisma.betParticipant.update({
        where: { id: p.id },
        data: { result: "tie" },
      });
      await payParticipant({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
    }
    await prisma.bet.update({
      where: { id: betId },
      data: { status: "voided", settledAt: new Date(), resultEventId: resultEvent.id },
    });
    await publishSignedEvent(resultEvent);
    after(() => emitBetRefunded(betId, "void"));
    return { ok: true, voided: true };
  }

  // Montos (msat). Pozo = stake * participantes (todos pagaron al estar ready).
  const { netMsat, feeMsat } = computeEconomics({
    stakeMsat: bet.stakeMsat,
    participantCount: bet.participants.length,
    feePct: bet.feePct,
  });
  const { perWinner, dust } = splitWinnings(netMsat, winners.length);

  // Fee de la casa (la guarda Luna Negra; se asienta al toque).
  const feeRec = await recordOutflow({
    betId,
    userId: null,
    kind: "fee",
    amountMsat: feeMsat + dust,
    idempotencyKey: `fee:${betId}`,
  });
  if (feeRec.ok) {
    await prisma.ledgerEntry.update({
      where: { idempotencyKey: `fee:${betId}` },
      data: { status: "settled" },
    });
  }

  const resultVal = winners.length > 1 ? "tie" : "won";
  for (const w of winners) {
    await prisma.betParticipant.update({ where: { id: w.id }, data: { result: resultVal } });
    await payParticipant({ bet, participant: w, amountMsat: perWinner, kind: "payout" });
  }
  await prisma.betParticipant.updateMany({
    where: { betId, id: { notIn: winners.map((w) => w.id) } },
    data: { result: "lost" },
  });

  await prisma.bet.update({
    where: { id: betId },
    data: { status: "settled", settledAt: new Date(), resultEventId: resultEvent.id },
  });

  // Republicar el evento firmado del resultado (prueba en Nostr).
  await publishSignedEvent(resultEvent);

  after(() => emitBetSettled(betId));
  return { ok: true };
}
