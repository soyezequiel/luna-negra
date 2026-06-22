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

  // Salvaguarda: en producción NUNCA generamos un bolt11 simulado. Sin un wallet
  // NWC configurado, el modo dev devolvía un invoice falso (`lnbc-dev-…`) que el
  // juego mostraba como QR escaneable pero ninguna billetera podía pagar (y la
  // extensión WebLN lo rechazaba, así que "el botón de pago no hacía nada").
  // Mejor fallar fuerte y visible: el v1/route lo captura y expone `depositError`,
  // y el operador ve que falta `NWC_CONNECTION_STRING` en vez de un QR roto mudo.
  if (devMode && process.env.NODE_ENV === "production") {
    throw new Error(
      "Lightning no está configurado (falta NWC_CONNECTION_STRING). " +
        "No se puede generar el invoice de depósito en producción.",
    );
  }

  // Reusamos el invoice guardado salvo que sea un placeholder de modo dev
  // (`lnbc-dev-…`) y ahora SÍ tengamos wallet: en ese caso quedó un QR inválido
  // guardado de cuando no había Lightning, así que lo regeneramos como real.
  const storedIsDevPlaceholder = part.depositInvoice?.startsWith("lnbc-dev-") ?? false;
  if (part.depositInvoice && part.depositPaymentHash && (devMode || !storedIsDevPlaceholder)) {
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
