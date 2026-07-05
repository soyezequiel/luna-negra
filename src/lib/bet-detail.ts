import type { Prisma } from "@prisma/client";
import { msatToSats } from "@/lib/money";

// Forma canónica del detalle COMPLETO de una apuesta (v1 escrow / v2 zaps) y el
// mapeo desde las filas de Prisma. Vive acá (no en la route admin) para que tanto
// el endpoint admin como la página pública /apuestas/[id] armen exactamente la
// misma estructura y compartan el componente de visualización (árbol de flujo,
// tabla de participantes, ledger). Los campos de zap solo se llenan en v2.

const sats = (m: bigint | null | undefined) =>
  m == null ? null : Number(msatToSats(m));

export type AdminBetParticipant = {
  seat: number;
  npub: string;
  name: string | null;
  deposit: {
    status: string; // pending | paid | refunded | failed
    kind: "zap" | "invoice" | null;
    receiptId: string | null; // 9735 del depósito (solo v2)
    receiptOk: boolean | null; // ≥1 relay aceptó el recibo (solo v2)
    paidAt: string | null;
  };
  result: string; // pending | won | lost | tie
  payout: {
    status: string; // none|pending|paid|failed|withdraw_pending|claimed|forfeited
    sats: number | null;
    kind: string | null; // zap | lnurl | withdraw (solo v2)
    destination: string | null;
    zapRequestId: string | null; // 9734 firmado por Luna Negra (solo v2)
    receiptId: string | null; // 9735 emitido por el wallet del receptor (solo v2)
    settledAt: string | null;
  };
};

export type AdminBetLedgerRow = {
  kind: string; // deposit | payout | refund | fee | dev_fee | forfeit
  sats: number;
  status: string; // pending | settled | failed
  has9734: boolean;
  has9735: boolean;
};

export type AdminBetDetail = {
  id: string;
  version: 1 | 2;
  gameTitle: string;
  providerName: string;
  status: string;
  stakeSats: number;
  potSats: number;
  feePct: number;
  devFeePct: number;
  victoryCondition: string;
  roomId: string | null;
  contractEventId: string | null; // v1 contractEventId / v2 anchorEventId
  contractHash: string | null;
  resultEventId: string | null;
  createdAt: string;
  settledAt: string | null;
  participants: AdminBetParticipant[];
  ledger: AdminBetLedgerRow[];
};

// Include mínimo que necesitan las funciones de mapeo (game, provider, la relación
// user de cada participante y el ledger). Reutilizable en cualquier consulta.
export const betDetailInclude = {
  game: true,
  provider: true,
  participants: { include: { user: true }, orderBy: { createdAt: "asc" } },
  ledger: { orderBy: { createdAt: "asc" } },
} as const;

type ZapBetWithDetail = Prisma.ZapBetGetPayload<{
  include: typeof betDetailInclude;
}>;
type BetWithDetail = Prisma.BetGetPayload<{ include: typeof betDetailInclude }>;

// v2 (zaps): incluye recibos 9735, tipo de depósito (zap/invoice) y payout.
export function buildZapBetDetail(b: ZapBetWithDetail): AdminBetDetail {
  return {
    id: b.id,
    version: 2,
    gameTitle: b.game.title,
    providerName: b.provider.name,
    status: b.status,
    stakeSats: sats(b.stakeMsat)!,
    potSats: sats(b.stakeMsat)! * b.participants.length,
    feePct: b.feePct,
    devFeePct: b.devFeePct,
    victoryCondition: b.victoryCondition,
    roomId: b.roomId,
    contractEventId: b.anchorEventId,
    contractHash: b.contractHash,
    resultEventId: b.resultEventId,
    createdAt: b.createdAt.toISOString(),
    settledAt: b.settledAt?.toISOString() ?? null,
    participants: b.participants.map((p, i) => ({
      seat: i + 1,
      npub: p.npub,
      name: p.user.displayName,
      deposit: {
        status: p.depositStatus,
        kind: p.depositReceiptId || p.depositZapRequest
          ? "zap"
          : p.depositInvoice
            ? "invoice"
            : null,
        receiptId: p.depositReceiptId,
        receiptOk: p.depositReceiptOk,
        paidAt: p.paidAt?.toISOString() ?? null,
      },
      result: p.result,
      payout: {
        status: p.payoutStatus,
        sats: sats(p.payoutMsat),
        kind: p.payoutKind,
        destination: p.payoutDestination,
        zapRequestId: p.payoutZapRequestId,
        receiptId: p.payoutReceiptId,
        settledAt: p.settledAt?.toISOString() ?? null,
      },
    })),
    ledger: b.ledger.map((l) => ({
      kind: l.kind,
      sats: sats(l.amountMsat)!,
      status: l.status,
      has9734: Boolean(l.zapRequestId),
      has9735: Boolean(l.zapReceiptId),
    })),
  };
}

// v1 (escrow): sin campos de zap.
export function buildV1BetDetail(b: BetWithDetail): AdminBetDetail {
  return {
    id: b.id,
    version: 1,
    gameTitle: b.game.title,
    providerName: b.provider.name,
    status: b.status,
    stakeSats: sats(b.stakeMsat)!,
    potSats: sats(b.stakeMsat)! * b.participants.length,
    feePct: b.feePct,
    devFeePct: b.devFeePct,
    victoryCondition: b.victoryCondition,
    roomId: b.roomId,
    contractEventId: b.contractEventId,
    contractHash: b.contractHash,
    resultEventId: b.resultEventId,
    createdAt: b.createdAt.toISOString(),
    settledAt: b.settledAt?.toISOString() ?? null,
    participants: b.participants.map((p, i) => ({
      seat: i + 1,
      npub: p.npub,
      name: p.user.displayName,
      deposit: {
        status: p.depositStatus,
        kind: p.depositInvoice ? "invoice" : null,
        receiptId: null,
        receiptOk: null,
        paidAt: p.paidAt?.toISOString() ?? null,
      },
      result: p.result,
      payout: {
        status: p.payoutStatus,
        sats: sats(p.payoutMsat),
        kind: null,
        destination: p.payoutDestination,
        zapRequestId: null,
        receiptId: null,
        settledAt: p.settledAt?.toISOString() ?? null,
      },
    })),
    ledger: b.ledger.map((l) => ({
      kind: l.kind,
      sats: sats(l.amountMsat)!,
      status: l.status,
      has9734: false,
      has9735: false,
    })),
  };
}
