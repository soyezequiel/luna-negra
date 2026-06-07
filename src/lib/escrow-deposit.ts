import { randomBytes } from "crypto";
import type { Bet, BetParticipant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createInvoice, lightningConfigured } from "@/lib/lightning";
import { msatToSats } from "@/lib/money";

export type DepositInvoice = {
  invoice: string; // bolt11
  paymentHash: string;
  devMode: boolean;
};

/**
 * Devuelve (creándolo si hace falta) el invoice de depósito de un participante.
 * Idempotente: si ya tiene invoice guardado, lo reusa. En modo dev (sin NWC)
 * genera un bolt11/hash simulado para poder probar el flujo sin pagar Lightning.
 * Compartido por el route de depósito del jugador y la vista v1 de depósitos.
 */
export async function ensureDepositInvoice(
  bet: Bet,
  part: BetParticipant,
): Promise<DepositInvoice> {
  const devMode = !lightningConfigured();

  if (part.depositInvoice && part.depositPaymentHash) {
    return { invoice: part.depositInvoice, paymentHash: part.depositPaymentHash, devMode };
  }

  const sats = Number(msatToSats(bet.stakeMsat));
  const inv = devMode
    ? {
        invoice: `lnbc-dev-${randomBytes(12).toString("hex")}`,
        paymentHash: `dev-${randomBytes(16).toString("hex")}`,
      }
    : await createInvoice(sats, `Luna Negra · apuesta ${bet.id}`);

  await prisma.betParticipant.update({
    where: { id: part.id },
    data: { depositInvoice: inv.invoice, depositPaymentHash: inv.paymentHash },
  });

  return { invoice: inv.invoice, paymentHash: inv.paymentHash, devMode };
}
