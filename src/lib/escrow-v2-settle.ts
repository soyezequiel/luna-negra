import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { nip19, type Event } from "nostr-tools";
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
  BET_SETTLE_NOTE_MIN_POT_SATS,
} from "@/lib/escrow-v2-config";
import { emitBetSettledV2, emitBetRefundedV2 } from "@/lib/webhooks";
import { msatToSats } from "@/lib/money";
import { notifyOperationalError } from "@/lib/discord";
import { isUnlistedBet } from "@/lib/nge-meta";
import { notifyNgeBetUpdated } from "@/lib/nge-notify";
import { RELAYS } from "@/lib/constants";

// `after()` tira fuera de un request scope, y este núcleo también corre desde el
// watcher NGP de resultados (setInterval en instrumentation): ahí caemos a una
// promesa flotante — en self-host el proceso sigue vivo y completa igual (mismo
// criterio que trackIntegration).
function scheduleAfter(fn: () => unknown): void {
  try {
    after(fn);
  } catch {
    void fn();
  }
}

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

function nostrEventRef(id: string, kind?: number): string {
  return `nostr:${nip19.neventEncode({ id, relays: RELAYS.slice(0, 3), kind })}`;
}

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
    // Nota + evento de resultado a relays en paralelo (independientes; en serie sumaban).
    const [noteId, resultAccepted] = await Promise.all([
      publishSettleNoteFor(bet, [], 0n, 0n, resultEvent).catch(async (error) => {
        await notifyOperationalError({
          source: "escrow-v2-settle-note",
          error,
          fingerprint: `escrow-v2-settle-note:${betId}`,
          context: { betId, result: "void" },
        });
        return null;
      }),
      publishSignedEvent(resultEvent),
    ]);
    await prisma.zapBet.update({
      where: { id: betId },
      data: {
        status: "voided",
        settledAt: new Date(),
        ...(resultAccepted > 0
          ? { resultEventId: resultEvent.id, resultEventKind: resultEvent.kind }
          : {}),
        ...(noteId ? { settleNoteId: noteId } : {}),
      },
    });
    scheduleAfter(() => emitBetRefundedV2(betId, "void"));
    scheduleAfter(() => notifyNgeBetUpdated(betId));
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

  // Corte de la casa (dust incluido) = la diferencia que queda en el pozo. No es un
  // movimiento saliente: se retiene en el NWC de la casa (asiento `fee` settled).
  await payHouseFeeV2({ bet, amountMsat: feeMsat + dust });

  // El GANADOR cobra primero: su zap es lo único que el jugador está esperando en
  // vivo (Tetris pollea el detalle cada 2s), así que todo lo que se serialice antes
  // (el zap del dev son 2 fetches LNURL + un pago NWC) es demora visible del premio.
  // Los montos ya están fijados por computeEconomics, así que el orden no cambia la
  // solvencia del pozo.
  const resultVal = winners.length > 1 ? "tie" : "won";
  for (const w of winners) {
    await prisma.zapBetParticipant.update({ where: { id: w.id }, data: { result: resultVal } });
    await payParticipantV2({ bet, participant: w, amountMsat: perWinner, kind: "payout" });
  }
  await prisma.zapBetParticipant.updateMany({
    where: { betId, id: { notIn: winners.map((w) => w.id) } },
    data: { result: "lost" },
  });

  // Corte del dev (proveedor): sale del pozo como profile-zap.
  if (devFeeMsat > 0n) {
    await payProviderFeeV2({ bet, amountMsat: devFeeMsat });
  }

  // Nota de liquidación pública (después de los pagos: ya tenemos recibos/preimages).
  // La nota y el evento de resultado van a relays EN PARALELO: son independientes y
  // cada uno puede tardar hasta su timeout de publicación; en serie sumaban.
  const fresh = await prisma.zapBetParticipant.findMany({ where: { betId } });
  const [noteId, resultAccepted] = await Promise.all([
    publishSettleNoteFor(
      { ...bet, participants: fresh },
      fresh.filter((p) => winners.some((w) => w.id === p.id)),
      feeMsat + dust,
      devFeeMsat,
      resultEvent,
    ).catch(async (error) => {
      await notifyOperationalError({
        source: "escrow-v2-settle-note",
        error,
        fingerprint: `escrow-v2-settle-note:${betId}`,
        context: { betId, result: "settled" },
      });
      return null;
    }),
    publishSignedEvent(resultEvent),
  ]);
  await prisma.zapBet.update({
    where: { id: betId },
    data: {
      status: "settled",
      settledAt: new Date(),
      ...(resultAccepted > 0
        ? { resultEventId: resultEvent.id, resultEventKind: resultEvent.kind }
        : {}),
      ...(noteId ? { settleNoteId: noteId } : {}),
    },
  });

  scheduleAfter(() => emitBetSettledV2(betId));
  scheduleAfter(() => notifyNgeBetUpdated(betId));
  return { ok: true };
}

/**
 * Publica la nota de liquidación (kind:1) anclada al contrato. EDITORIAL, no
 * normativa: la auditoría máquina completa vive en el 31340 y los recibos 9735
 * (la nota puede no existir y la apuesta sigue siendo verificable). Reglas:
 *  - Umbral: solo si el pozo llega a BET_SETTLE_NOTE_MIN_POT_SATS (las
 *    microapuestas no ameritan un post).
 *  - Apuestas "unlisted": sin nota.
 *  - p-tag SOLO a los ganadores (celebración); nunca a los perdedores.
 * Devuelve el id (o null si se omitió, no hay nsec o ningún relay la aceptó).
 * No bloquea el pago.
 */
async function publishSettleNoteFor(
  bet: ZapBet & { participants: ZapBetParticipant[] },
  winners: ZapBetParticipant[],
  houseFeeMsat: bigint,
  devFeeMsat: bigint,
  resultEvent: Event,
): Promise<string | null> {
  if (!bet.anchorEventId || bet.anchorEventId.startsWith("dev-anchor-")) return null;
  if (isUnlistedBet(bet)) return null;
  const potSats = sats(bet.stakeMsat) * bet.participants.length;
  if (potSats < BET_SETTLE_NOTE_MIN_POT_SATS) return null;

  const game = await prisma.game
    .findUnique({ where: { id: bet.gameId }, select: { title: true } })
    .catch(() => null);
  const enDonde = game?.title ? ` en ${game.title}` : "";
  const detailUrl = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/apuestas/${bet.id}`;

  const lines: string[] = [];
  if (winners.length === 0) {
    lines.push(`🤝 Empate${enDonde}: cada participante recuperó sus ${sats(bet.stakeMsat)} sats.`);
  } else {
    const quien = winners.map((w) => `nostr:${w.npub}`).join(" y ");
    const premio = winners[0].payoutMsat ? sats(winners[0].payoutMsat) : null;
    const gano = winners.length > 1 ? "ganaron" : "ganó";
    const cuanto = premio ? ` ${premio} sats${winners.length > 1 ? " cada uno" : ""}` : "";
    lines.push(`🏆 ${quien} ${gano}${cuanto} apostando${enDonde}.`);
  }
  lines.push(``, `Detalle y pruebas: ${detailUrl}`);
  // Referencias probatorias compactas (el desglose completo está en la página y
  // en el 31340): contrato, resultado firmado y recibo del premio si ya existe.
  const refs: string[] = [
    `Contrato: ${nostrEventRef(bet.anchorEventId, bet.anchorEventKind ?? 1)}`,
    `Resultado: ${nostrEventRef(resultEvent.id, resultEvent.kind)}`,
  ];
  for (const w of winners) {
    if (w.payoutReceiptId) refs.push(`Recibo: ${nostrEventRef(w.payoutReceiptId, 9735)}`);
  }
  lines.push(refs.join(" · "));
  if (winners.length > 0) {
    const feeBits = [`casa ${sats(houseFeeMsat)} sats`];
    if (devFeeMsat > 0n) feeBits.push(`dev ${sats(devFeeMsat)} sats`);
    lines.push(`Comisiones: ${feeBits.join(" · ")}.`);
  }

  const tags: string[][] = [
    ["t", BET_V2_SETTLE_TAG],
    ["bet", bet.id],
    ["e", bet.anchorEventId],
    ...winners.map((w) => ["p", w.pubkey]),
  ];
  return publishSettleNote(lines.join("\n"), tags);
}
