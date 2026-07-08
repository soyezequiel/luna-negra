import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDepositInvoice } from "@/lib/escrow-deposit";
import { BETS_V1_ENABLED } from "@/lib/escrow-config";

// LNURL-pay (LUD-06) para el depósito de un participante. Dos pasos:
//   1) GET sin `?amount`  → payRequest (callback + min/max = stake fijo).
//   2) GET con `?amount`  → { pr: <bolt11> } (el invoice de depósito).
// Monto fijo: el stake de la apuesta. Respalda el handle `lnurl` de la vista de
// depósitos. Errores en formato LUD-06: { status: "ERROR", reason }.

const lnurlError = (reason: string) =>
  NextResponse.json({ status: "ERROR", reason });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ pid: string }> },
) {
  // Guard v1 en formato LUD-06 (los wallets esperan { status: "ERROR" }).
  if (!BETS_V1_ENABLED) return lnurlError("Las apuestas v1 fueron retiradas");
  const { pid } = await params;
  const part = await prisma.betParticipant.findUnique({
    where: { id: pid },
    include: { bet: true },
  });
  if (!part) return lnurlError("Participante no encontrado");

  const bet = part.bet;
  const open =
    bet.status === "pending_deposits" &&
    (bet.depositDeadline == null || bet.depositDeadline > new Date());
  if (!open) return lnurlError("El depósito está cerrado");
  if (part.depositStatus === "paid") return lnurlError("Ya depositaste");

  const amountMsat = Number(bet.stakeMsat);
  const url = new URL(req.url);
  const amount = url.searchParams.get("amount");

  // Paso 2: el wallet pide el invoice por el monto exacto.
  if (amount != null) {
    if (Number(amount) !== amountMsat) {
      return lnurlError(`Monto debe ser exactamente ${amountMsat} msat`);
    }
    const inv = await ensureDepositInvoice(bet, part);
    return NextResponse.json({ pr: inv.invoice, routes: [] });
  }

  // Paso 1: parámetros del payRequest (monto fijo = stake).
  const metadata = JSON.stringify([
    ["text/plain", `Luna Negra · depósito apuesta ${bet.id}`],
  ]);
  return NextResponse.json({
    tag: "payRequest",
    callback: `${url.origin}${url.pathname}`,
    minSendable: amountMsat,
    maxSendable: amountMsat,
    metadata,
  });
}
