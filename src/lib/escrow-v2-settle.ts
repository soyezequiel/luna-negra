import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type { Event } from "nostr-tools";
import type { ZapBet, ZapBetParticipant, Provider, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeContractHash } from "@/lib/escrow";
import {
  computeEconomics,
  splitWinnings,
  publicBetStatus,
  routingReserveMsat,
} from "@/lib/escrow-math";
import { isTerminal } from "@/lib/bet-state";
import {
  payParticipantV2,
  payProviderFeeV2,
  payHouseFeeV2,
} from "@/lib/escrow-v2-payout";
import { publishSignedEvent, publishSettleNote } from "@/lib/nostr-server";
import { payoutsWillUseFallback } from "@/lib/lightning";
import {
  BET_FEE_MIN_MSAT,
  BET_FALLBACK_ROUTING_PCT,
  BET_V2_SETTLE_TAG,
} from "@/lib/escrow-v2-config";
import { emitBetSettledV2, emitBetRefundedV2 } from "@/lib/webhooks";
import { msatToSats } from "@/lib/money";
import { notifyOperationalError } from "@/lib/discord";

export type ZapBetWithRelations = ZapBet & {
  provider: Provider & { owner: User };
  participants: ZapBetParticipant[];
};

export type SettleResult =
  | { ok: true; voided?: boolean; alreadyResolved?: boolean; finalStatus?: string }
  | { ok: false; code: string; message: string; status: number };

/**
 * Núcleo de liquidación de una apuesta v2 (zaps). Espejo de settleBetWithResult:
 * mismos invariantes (claim ready→settling, verificación del hash del contrato,
 * idempotencia terminal, revert a ready si lanza). La diferencia: los pagos salen
 * por zap (pay*V2) y al final se publica una NOTA DE LIQUIDACIÓN kind:1 anclada al
 * contrato con el resumen público (ganadores, montos, recibos, fees).
 */
export async function settleZapBetWithResult(args: {
  bet: ZapBetWithRelations;
  winnerNpubs: string[];
  resultEvent: Event;
}): Promise<SettleResult> {
  const { bet, winnerNpubs, resultEvent } = args;
  const betId = bet.id;

  if (isTerminal(bet.status)) {
    return {
      ok: true,
      alreadyResolved: true,
      voided: bet.status === "voided",
      finalStatus: publicBetStatus(bet.status),
    };
  }

  const claimed = await prisma.zapBet.updateMany({
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
    await prisma.zapBet
      .updateMany({ where: { id: betId, status: "settling" }, data: { status: "ready" } })
      .catch(() => {});
    Sentry.captureException(err, { level: "error", tags: { flow: "escrow-v2-settle", betId } });
    console.error(`[escrow-v2] falló la liquidación de ${betId}; revertido a ready:`, err);
    await notifyOperationalError({
      source: "escrow-v2-settle",
      error: err,
      fingerprint: `escrow-v2-settle:${betId}`,
      context: { betId, winnerNpubs },
    });
    return {
      ok: false,
      code: "SETTLE_FAILED",
      message: err instanceof Error ? err.message : "Falló la liquidación; reintentá el cobro",
      status: 503,
    };
  }
}

const sats = (msat: bigint) => Number(msatToSats(msat));

/** Cuerpo de la liquidación v2, ya reclamado `settling`. Si lanza, el caller revierte. */
async function runSettlement(args: {
  bet: ZapBetWithRelations;
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
      await prisma.zapBet.updateMany({
        where: { id: betId, status: "settling" },
        data: { status: "ready" },
      });
      console.error(
        `[escrow-v2] términos alterados en ${betId}: contrato=${bet.contractHash} vivo=${liveHash}`,
      );
      await notifyOperationalError({
        source: "escrow-v2-contract-mismatch",
        error: new Error("Los términos vivos no coinciden con el contrato firmado"),
        fingerprint: `escrow-v2-contract-mismatch:${betId}`,
        cooldownMs: 60 * 60_000,
        context: { betId, contractHash: bet.contractHash, liveHash },
      });
      return {
        ok: false,
        code: "CONTRACT_MISMATCH",
        message: "Los términos no coinciden con el contrato firmado; no se paga",
        status: 409,
      };
    }
  }

  const winners = bet.participants.filter((p) => winnerNpubs.includes(p.npub));

  // Sin ganadores válidos ⇒ empate/anulación ⇒ reembolso total por zap (sin fee).
  if (winners.length === 0) {
    for (const p of bet.participants) {
      await prisma.zapBetParticipant.update({ where: { id: p.id }, data: { result: "tie" } });
      await payParticipantV2({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
    }
    const noteId = await publishSettleNoteFor(bet, [], 0n, 0n).catch(async (error) => {
      await notifyOperationalError({
        source: "escrow-v2-settle-note",
        error,
        fingerprint: `escrow-v2-settle-note:${betId}`,
        context: { betId, result: "void" },
      });
      return null;
    });
    await prisma.zapBet.update({
      where: { id: betId },
      data: {
        status: "voided",
        settledAt: new Date(),
        resultEventId: resultEvent.id,
        ...(noteId ? { settleNoteId: noteId } : {}),
      },
    });
    await publishSignedEvent(resultEvent);
    after(() => emitBetRefundedV2(betId, "void"));
    return { ok: true, voided: true };
  }

  // Piso de comisión: si los premios van por el fallback (que cobra routing),
  // subimos el piso al routing estimado para que la casa no quede en rojo.
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

  // Fee de la casa (dust incluido). Nunca self-payment: payHouseFeeV2 decide zap
  // real (LUNA_FEE_LUD16) o asiento settled retenido.
  await payHouseFeeV2({ bet, amountMsat: feeMsat + dust });

  // Corte del dev (proveedor): sale del pozo como profile-zap.
  if (devFeeMsat > 0n) {
    await payProviderFeeV2({ bet, amountMsat: devFeeMsat });
  }

  const resultVal = winners.length > 1 ? "tie" : "won";
  for (const w of winners) {
    await prisma.zapBetParticipant.update({ where: { id: w.id }, data: { result: resultVal } });
    await payParticipantV2({ bet, participant: w, amountMsat: perWinner, kind: "payout" });
  }
  await prisma.zapBetParticipant.updateMany({
    where: { betId, id: { notIn: winners.map((w) => w.id) } },
    data: { result: "lost" },
  });

  // Nota de liquidación pública (después de los pagos: ya tenemos recibos/preimages).
  const fresh = await prisma.zapBetParticipant.findMany({ where: { betId } });
  const noteId = await publishSettleNoteFor(
    { ...bet, participants: fresh },
    fresh.filter((p) => winners.some((w) => w.id === p.id)),
    feeMsat + dust,
    devFeeMsat,
  ).catch(async (error) => {
    await notifyOperationalError({
      source: "escrow-v2-settle-note",
      error,
      fingerprint: `escrow-v2-settle-note:${betId}`,
      context: { betId, result: "settled" },
    });
    return null;
  });

  await prisma.zapBet.update({
    where: { id: betId },
    data: {
      status: "settled",
      settledAt: new Date(),
      resultEventId: resultEvent.id,
      ...(noteId ? { settleNoteId: noteId } : {}),
    },
  });

  await publishSignedEvent(resultEvent);
  after(() => emitBetSettledV2(betId));
  return { ok: true };
}

/**
 * Publica la nota de liquidación (kind:1) anclada al contrato: resume ganadores,
 * montos, ids de recibos/preimages y fees. Devuelve el id (o null si no hay nsec o
 * ningún relay la aceptó). No bloquea el pago; es la capa de auditoría pública.
 */
async function publishSettleNoteFor(
  bet: ZapBet & { participants: ZapBetParticipant[] },
  winners: ZapBetParticipant[],
  houseFeeMsat: bigint,
  devFeeMsat: bigint,
): Promise<string | null> {
  if (!bet.anchorEventId || bet.anchorEventId.startsWith("dev-anchor-")) return null;

  const lines: string[] = [`🌑 Liquidación de apuesta — Luna Negra`, `ID: ${bet.id}`];
  if (winners.length === 0) {
    lines.push(`Resultado: empate/anulación — se reembolsó el stake a cada participante por zap.`);
  } else {
    lines.push(`Ganador${winners.length > 1 ? "es" : ""}:`);
    for (const w of winners) {
      const amt = w.payoutMsat ? `${sats(w.payoutMsat)} sats` : "—";
      const via =
        w.payoutKind === "zap"
          ? `zap${w.payoutReceiptId ? ` (recibo ${w.payoutReceiptId})` : ""}`
          : w.payoutKind ?? "pendiente";
      lines.push(`• ${w.npub}: ${amt} vía ${via}`);
    }
    lines.push(`Comisión de la casa: ${sats(houseFeeMsat)} sats.`);
    if (devFeeMsat > 0n) lines.push(`Corte del desarrollador: ${sats(devFeeMsat)} sats.`);
  }

  const tags: string[][] = [
    ["t", BET_V2_SETTLE_TAG],
    ["bet", bet.id],
    ["e", bet.anchorEventId],
    ...winners.map((w) => ["p", w.pubkey]),
  ];
  return publishSettleNote(lines.join("\n"), tags);
}
