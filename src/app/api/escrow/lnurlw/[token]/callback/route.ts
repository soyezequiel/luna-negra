import { NextResponse } from "next/server";
import { decodeInvoice } from "@getalby/lightning-tools";
import { prisma } from "@/lib/prisma";
import { verifyWithdrawToken } from "@/lib/auth";
import { payInvoiceRaw } from "@/lib/lightning";
import { msatToSats } from "@/lib/money";

const CORS = { "Access-Control-Allow-Origin": "*" };
const err = (reason: string) =>
  NextResponse.json({ status: "ERROR", reason }, { headers: CORS });

// LNURL-withdraw callback: el wallet manda su invoice (pr) y Luna Negra lo paga.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = new URL(req.url);
  const k1 = url.searchParams.get("k1");
  const pr = url.searchParams.get("pr");

  const pid = await verifyWithdrawToken(token);
  if (!pid || k1 !== token || !pr) return err("Parámetros inválidos");

  // El token no distingue versión: la apuesta puede ser v1 (betParticipant +
  // ledgerEntry) o v2/zaps (zapBetParticipant + zapLedgerEntry). Resolvemos por
  // tabla y ejecutamos el mismo protocolo (validar monto → claim atómico → pagar
  // → settlear el asiento de ledger pendiente → marcar claimed) sobre la que aplique.
  const v1 = await prisma.betParticipant.findUnique({ where: { id: pid } });
  if (v1) return handleWithdraw(v1, pr, "v1");
  const v2 = await prisma.zapBetParticipant.findUnique({ where: { id: pid } });
  if (v2) return handleWithdraw(v2, pr, "v2");
  return err("Retiro no disponible");
}

type WithdrawParticipant = {
  id: string;
  betId: string;
  userId: string;
  payoutStatus: string;
  payoutMsat: bigint | null;
  withdrawDeadline: Date | null;
};

async function handleWithdraw(
  part: WithdrawParticipant,
  pr: string,
  version: "v1" | "v2",
): Promise<Response> {
  if (
    part.payoutStatus !== "withdraw_pending" ||
    !part.payoutMsat ||
    (part.withdrawDeadline && part.withdrawDeadline < new Date())
  ) {
    return err("Retiro no disponible");
  }

  // Validar que el invoice pide exactamente lo adeudado.
  const expectedSats = Number(msatToSats(part.payoutMsat));
  const decoded = decodeInvoice(pr);
  if (!decoded || decoded.satoshi !== expectedSats) {
    return err("Monto del invoice incorrecto");
  }

  // Claim atómico para evitar doble retiro (sobre la tabla que corresponda).
  const claim =
    version === "v1"
      ? await prisma.betParticipant.updateMany({
          where: { id: part.id, payoutStatus: "withdraw_pending" },
          data: { payoutStatus: "withdraw_claiming" },
        })
      : await prisma.zapBetParticipant.updateMany({
          where: { id: part.id, payoutStatus: "withdraw_pending" },
          data: { payoutStatus: "withdraw_claiming" },
        });
  if (claim.count !== 1) return err("Retiro ya en proceso");

  try {
    const preimage = await payInvoiceRaw(pr);
    if (version === "v1") {
      await prisma.ledgerEntry.updateMany({
        where: {
          betId: part.betId,
          userId: part.userId,
          status: "pending",
          kind: { in: ["payout", "refund"] },
        },
        data: { status: "settled", paymentHash: preimage },
      });
      await prisma.betParticipant.update({
        where: { id: part.id },
        data: {
          payoutStatus: "claimed",
          settledAt: new Date(),
          payoutDestination: "lnurl-withdraw",
        },
      });
    } else {
      await prisma.zapLedgerEntry.updateMany({
        where: {
          betId: part.betId,
          userId: part.userId,
          status: "pending",
          kind: { in: ["payout", "refund"] },
        },
        data: { status: "settled", paymentHash: preimage },
      });
      await prisma.zapBetParticipant.update({
        where: { id: part.id },
        data: {
          payoutStatus: "claimed",
          payoutKind: "withdraw",
          settledAt: new Date(),
          payoutDestination: "lnurl-withdraw",
        },
      });
    }
    return NextResponse.json({ status: "OK" }, { headers: CORS });
  } catch {
    if (version === "v1") {
      await prisma.betParticipant.updateMany({
        where: { id: part.id, payoutStatus: "withdraw_claiming" },
        data: { payoutStatus: "withdraw_pending" },
      });
    } else {
      await prisma.zapBetParticipant.updateMany({
        where: { id: part.id, payoutStatus: "withdraw_claiming" },
        data: { payoutStatus: "withdraw_pending" },
      });
    }
    return err("No se pudo pagar el invoice");
  }
}
