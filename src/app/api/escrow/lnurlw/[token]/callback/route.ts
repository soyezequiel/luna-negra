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

  const part = await prisma.betParticipant.findUnique({ where: { id: pid } });
  if (
    !part ||
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

  // Claim atómico para evitar doble retiro.
  const claim = await prisma.betParticipant.updateMany({
    where: { id: pid, payoutStatus: "withdraw_pending" },
    data: { payoutStatus: "withdraw_claiming" },
  });
  if (claim.count !== 1) return err("Retiro ya en proceso");

  try {
    const preimage = await payInvoiceRaw(pr);
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
      where: { id: pid },
      data: {
        payoutStatus: "claimed",
        settledAt: new Date(),
        payoutDestination: "lnurl-withdraw",
      },
    });
    return NextResponse.json({ status: "OK" }, { headers: CORS });
  } catch {
    await prisma.betParticipant.updateMany({
      where: { id: pid, payoutStatus: "withdraw_claiming" },
      data: { payoutStatus: "withdraw_pending" },
    });
    return err("No se pudo pagar el invoice");
  }
}
