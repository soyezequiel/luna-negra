import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { msatToSats } from "@/lib/money";

// Detalle COMPLETO de una apuesta para el panel admin: sirve v1 (escrow) y v2
// (zaps). El front pasa `?v=1|2` (lo sabe por la fila); si falta, probamos v2 y
// caemos a v1. Devuelve todo lo necesario para auditar el flujo de plata y armar
// el árbol: quién depositó (y cómo: zap/invoice + recibo 9735), quién ganó, cómo
// cobró (zap/lnurl/withdraw + ids 9734/9735) y los asientos del ledger.

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

const include = {
  game: true,
  provider: true,
  participants: { include: { user: true }, orderBy: { createdAt: "asc" } },
  ledger: { orderBy: { createdAt: "asc" } },
} as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const { searchParams } = new URL(_req.url);
  const v = searchParams.get("v");

  // v2 (zaps) salvo que la fila diga v1 explícitamente.
  if (v !== "1") {
    const b = await prisma.zapBet.findUnique({ where: { id }, include });
    if (b) {
      const detail: AdminBetDetail = {
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
      return NextResponse.json(detail);
    }
    if (v === "2") {
      return NextResponse.json({ error: "Apuesta no encontrada" }, { status: 404 });
    }
  }

  // v1 (escrow): sin campos de zap.
  const b = await prisma.bet.findUnique({ where: { id }, include });
  if (!b) {
    return NextResponse.json({ error: "Apuesta no encontrada" }, { status: 404 });
  }
  const detail: AdminBetDetail = {
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
  return NextResponse.json(detail);
}
