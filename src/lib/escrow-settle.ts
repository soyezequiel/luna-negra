import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { Event } from "nostr-tools";
import type { Bet, BetParticipant, Provider, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordOutflow } from "@/lib/ledger";
import { computeContractHash } from "@/lib/escrow";
import {
  computeEconomics,
  splitWinnings,
  publicBetStatus,
  routingReserveMsat,
} from "@/lib/escrow-math";
import { isTerminal } from "@/lib/bet-state";
import { payParticipant, payProviderFee } from "@/lib/escrow-payout";
import { publishSignedEvent } from "@/lib/nostr-server";
import { payoutsWillUseFallback } from "@/lib/lightning";
import { BET_FEE_MIN_MSAT, BET_FALLBACK_ROUTING_PCT } from "@/lib/escrow-config";
import { emitBetSettled, emitBetRefunded } from "@/lib/webhooks";

export type BetWithRelations = Bet & {
  provider: Provider & { owner: User };
  participants: BetParticipant[];
};

export type SettleResult =
  | { ok: true; voided?: boolean; alreadyResolved?: boolean; finalStatus?: string }
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

  // Idempotencia: si la apuesta ya está en un estado terminal, no se re-liquida.
  // La plata ya quedó conciliada (pagada o reembolsada), así que un reporte
  // repetido es un no-op exitoso. El caller lee `status` para saber cómo terminó,
  // en vez de tener que adivinarlo a partir de un código de error.
  if (isTerminal(bet.status)) {
    return {
      ok: true,
      alreadyResolved: true,
      voided: bet.status === "voided",
      finalStatus: publicBetStatus(bet.status),
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

  try {
    return await runSettlement({ bet, betId, winnerNpubs, resultEvent });
  } catch (err) {
    // Algo falló DESPUÉS de reclamar `settling`. Sin esto la apuesta quedaría
    // atascada en `settling` para siempre: no es terminal, pero el claim
    // `ready → settling` ya no vuelve a ganar la carrera, así que cada reintento
    // (manual o por tick) devolvería NOT_READY sin fin. Revertimos a `ready` para
    // reabrir la carrera. Pagos y fee son idempotentes vía la idempotencyKey del
    // ledger, así que re-liquidar no duplica plata.
    await prisma.bet
      .updateMany({ where: { id: betId, status: "settling" }, data: { status: "ready" } })
      .catch(() => {});
    Sentry.captureException(err, {
      level: "error",
      tags: { flow: "escrow-settle", betId },
    });
    console.error(`[escrow] falló la liquidación de ${betId}; revertido a ready:`, err);
    return {
      ok: false,
      code: "SETTLE_FAILED",
      message:
        err instanceof Error
          ? err.message
          : "Falló la liquidación; reintentá el cobro",
      status: 503,
    };
  }
}

/** Cuerpo de la liquidación, ya reclamado `settling`. Si lanza, el caller revierte a `ready`. */
async function runSettlement(args: {
  bet: BetWithRelations;
  betId: string;
  winnerNpubs: string[];
  resultEvent: Event;
}): Promise<SettleResult> {
  const { bet, betId, winnerNpubs, resultEvent } = args;

  // Integridad: los términos vivos deben coincidir con el contrato firmado.
  if (bet.contractHash) {
    const liveHash = computeContractHash({
      betId: bet.id,
      gameId: bet.gameId,
      stakeMsat: bet.stakeMsat,
      feePct: bet.feePct,
      devFeePct: bet.devFeePct,
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
    const resultAccepted = await publishSignedEvent(resultEvent);
    await prisma.bet.update({
      where: { id: betId },
      data: {
        status: "voided",
        settledAt: new Date(),
        ...(resultAccepted > 0 ? { resultEventId: resultEvent.id } : {}),
      },
    });
    after(() => emitBetRefunded(betId, "void"));
    return { ok: true, voided: true };
  }

  // Montos (msat). Pozo = stake * participantes (todos pagaron al estar ready).
  // Piso de comisión: normalmente BET_FEE_MIN_MSAT. Si esta liquidación va a pagar
  // los premios por el wallet de FALLBACK (primario caído → ej. Rizful, que cobra
  // routing), subimos el piso al routing estimado para que la casa no quede en rojo
  // por el ruteo. Se estima sobre el payout por ganador de un primer cálculo base
  // (con el piso normal), por cada envío de premio (cada payout paga su routing).
  let feeMinMsat = BET_FEE_MIN_MSAT;
  if (payoutsWillUseFallback()) {
    const base = computeEconomics({
      stakeMsat: bet.stakeMsat,
      participantCount: bet.participants.length,
      feePct: bet.feePct,
      devFeePct: bet.devFeePct,
      feeMinMsat: BET_FEE_MIN_MSAT,
    });
    const { perWinner: basePerWinner } = splitWinnings(base.netMsat, winners.length);
    // Routing de cada premio al ganador + (si el dev cobra) el routing de su payout,
    // que también va por el fallback: un hop más a cubrir para no quedar en rojo.
    let reserveMsat =
      routingReserveMsat(basePerWinner, BET_FALLBACK_ROUTING_PCT) * BigInt(winners.length);
    if (base.devFeeMsat > 0n) {
      reserveMsat += routingReserveMsat(base.devFeeMsat, BET_FALLBACK_ROUTING_PCT);
    }
    if (reserveMsat > feeMinMsat) feeMinMsat = reserveMsat;
  }

  const { netMsat, feeMsat, devFeeMsat } = computeEconomics({
    stakeMsat: bet.stakeMsat,
    participantCount: bet.participants.length,
    feePct: bet.feePct,
    devFeePct: bet.devFeePct,
    feeMinMsat,
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

  // El GANADOR cobra primero (es lo que el jugador espera en vivo); el corte del
  // dev sale después. Los montos ya están fijados por computeEconomics, así que el
  // orden no cambia la solvencia del pozo.
  const resultVal = winners.length > 1 ? "tie" : "won";
  for (const w of winners) {
    await prisma.betParticipant.update({ where: { id: w.id }, data: { result: resultVal } });
    await payParticipant({ bet, participant: w, amountMsat: perWinner, kind: "payout" });
  }
  await prisma.betParticipant.updateMany({
    where: { betId, id: { notIn: winners.map((w) => w.id) } },
    data: { result: "lost" },
  });

  // Corte del dev (proveedor): sale del pozo y se paga a su dirección de cobro.
  if (devFeeMsat > 0n) {
    await payProviderFee({ bet, amountMsat: devFeeMsat });
  }

  // Republicar el evento firmado del resultado (prueba en Nostr). Sólo guardamos
  // su id si algún relay lo aceptó, para no dejar un link muerto.
  const resultAccepted = await publishSignedEvent(resultEvent);
  await prisma.bet.update({
    where: { id: betId },
    data: {
      status: "settled",
      settledAt: new Date(),
      ...(resultAccepted > 0 ? { resultEventId: resultEvent.id } : {}),
    },
  });

  after(() => emitBetSettled(betId));
  return { ok: true };
}
