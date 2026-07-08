import {
  NGP_BET_STATE_KIND,
  NGP_BET_TAG,
} from "./ngp-kinds";

// CAPA PROTOCOLO NGP — builders PUROS de los eventos públicos del escrow
// transparente (docs/nostr-games-protocol-apuestas.md). Sin prisma, sin I/O, sin
// env: reciben datos planos y devuelven templates sin firmar. El servicio
// (ngp-bet-state.ts) lee la DB, mapea a estos datos y publica; los tests pueden
// verificar el formato del protocolo sin tocar nada más.
//
// El formato de estos eventos está CONGELADO (v1 de la spec): cambiarlo acá es
// cambiar el protocolo, no un detalle de implementación.

export type NgpEventTemplate = {
  kind: number;
  created_at?: number;
  tags: string[][];
  content: string;
};

export type NgpDepositEntry = { p: string; receipt?: string };
export type NgpPayoutEntry = {
  p: string;
  sats: number;
  status: string;
  kind?: string;
  zapRequest?: string;
  receipt?: string;
};

/**
 * Template del estado del escrow (kind:31340, addressable, `d` = id del ancla).
 * Es el registro máquina COMPLETO de la apuesta: asientos declarados, depósitos
 * con recibos, payouts, referencias al resultado y a la nota de liquidación.
 */
export function buildNgpBetStateTemplate(p: {
  anchorEventId: string;
  gameCoord?: string | null;
  status: string;
  reason?: string | null;
  betId: string;
  stakeSats: number;
  /** Pubkeys de los asientos declarados, en orden (el ancla kind:1 no lleva
   *  p-tags de jugadores: el registro vive acá). */
  participants: string[];
  feePct: number;
  devFeePct: number;
  depositDeadline?: number | null;
  resolveDeadline?: number | null;
  deposits: NgpDepositEntry[];
  payouts?: NgpPayoutEntry[];
  resultEventId?: string | null;
  settleNoteId?: string | null;
  createdAt?: number;
}): NgpEventTemplate {
  const content = JSON.stringify({
    betId: p.betId,
    status: p.status,
    ...(p.reason ? { reason: p.reason } : {}),
    stakeSats: p.stakeSats,
    seats: p.participants.length,
    participants: p.participants,
    feePct: p.feePct,
    devFeePct: p.devFeePct,
    ...(p.depositDeadline ? { depositDeadline: p.depositDeadline } : {}),
    ...(p.resolveDeadline ? { resolveDeadline: p.resolveDeadline } : {}),
    deposits: p.deposits,
    ...(p.payouts && p.payouts.length ? { payouts: p.payouts } : {}),
    ...(p.resultEventId ? { resultEvent: p.resultEventId } : {}),
    ...(p.settleNoteId ? { settleNote: p.settleNoteId } : {}),
  });
  return {
    kind: NGP_BET_STATE_KIND,
    ...(p.createdAt ? { created_at: p.createdAt } : {}),
    tags: [
      ["d", p.anchorEventId],
      ["e", p.anchorEventId],
      ...(p.gameCoord ? [["a", p.gameCoord]] : []),
      ["status", p.status],
      ["bet", p.betId],
      ["t", NGP_BET_TAG],
    ],
    content,
  };
}

/**
 * Template de las condiciones del escrow (kind:31340, `d`="terms"): comisiones
 * por defecto, límites de stake y ventanas. Lo que un juego lee ANTES de crear
 * un contrato (spec §2.1).
 */
export function buildNgpTermsTemplate(p: {
  minStakeSats: number;
  maxStakeSats: number;
  feePct: number;
  devFeeMaxPct: number;
  feeMinSats: number;
  maxSeats: number;
  depositWindowSec: number;
  resolveWindowSec: number;
  withdrawWindowSec: number;
}): NgpEventTemplate {
  return {
    kind: NGP_BET_STATE_KIND,
    tags: [
      ["d", "terms"],
      ["t", NGP_BET_TAG],
    ],
    content: JSON.stringify(p),
  };
}
