import { SimplePool, nip57, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { getStorePubkey } from "./nostr-server";

/**
 * Reconciliación de recibos de PAYOUT de apuestas v2. Cuando Luna Negra zapea al
 * ganador (payoutKind = "zap"), el recibo 9735 lo emite el wallet del RECEPTOR, no
 * la tienda: aparece en relays de forma asincrónica. Este sync lo levanta y
 * completa `payoutReceiptId` (+ el `zapReceiptId` del asiento del ledger), cerrando
 * la auditoría del zap saliente sin bloquear el pago (que ya se hizo).
 *
 * Es un espejo ACOTADO de zap-sync.ts: mismo patrón de pool + querySync + dedup,
 * pero el matching es por el 9734 que FIRMAMOS nosotros (su id == payoutZapRequestId).
 * El scheduler vive en src/instrumentation.ts.
 */

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

export async function syncZapBetReceipts(): Promise<void> {
  const storePubkey = getStorePubkey();
  if (!storePubkey) return; // sin identidad de la tienda no firmamos 9734 salientes

  // Participantes con payout por zap todavía sin recibo, de apuestas ancladas.
  const pending = await prisma.zapBetParticipant.findMany({
    where: {
      payoutKind: "zap",
      payoutReceiptId: null,
      payoutZapRequestId: { not: null },
    },
    select: {
      id: true,
      betId: true,
      userId: true,
      payoutZapRequestId: true,
      bet: { select: { anchorEventId: true } },
    },
  });
  if (pending.length === 0) return;

  // Índice: 9734 que firmamos (payoutZapRequestId) → participante.
  const byRequestId = new Map<string, (typeof pending)[number]>();
  const anchors = new Set<string>();
  for (const p of pending) {
    if (p.payoutZapRequestId) byRequestId.set(p.payoutZapRequestId, p);
    const a = p.bet.anchorEventId;
    if (a && !a.startsWith("dev-anchor-")) anchors.add(a);
  }
  if (anchors.size === 0) return;

  let receipts: Event[];
  try {
    receipts = await pool().querySync(
      RELAYS,
      { kinds: [9735], "#e": [...anchors] },
      { maxWait: 5000 },
    );
  } catch {
    return; // relays caídos: reintentamos en el próximo tick
  }

  for (const receipt of receipts) {
    try {
      await recordPayoutReceipt(receipt, byRequestId, storePubkey);
    } catch {
      /* recibo inválido o ya registrado: seguimos con el resto */
    }
  }
}

async function recordPayoutReceipt(
  receipt: Event,
  byRequestId: Map<string, { id: string; betId: string; userId: string }>,
  storePubkey: string,
): Promise<void> {
  if (receipt.kind !== 9735) return;

  // El 9734 embebido (description) es el que FIRMAMOS nosotros para pagar el zap.
  const desc = receipt.tags.find((t) => t[0] === "description")?.[1];
  if (!desc || nip57.validateZapRequest(desc)) return;

  let zr: { id?: string; pubkey?: string };
  try {
    zr = JSON.parse(desc);
  } catch {
    return;
  }
  // Debe estar firmado por la tienda y su id debe corresponder a un payout pendiente.
  if (zr.pubkey !== storePubkey || !zr.id) return;
  const part = byRequestId.get(zr.id);
  if (!part) return;

  // Completa la auditoría: recibo en el participante y en el asiento del ledger.
  await prisma.zapBetParticipant.update({
    where: { id: part.id },
    data: { payoutReceiptId: receipt.id },
  });
  await prisma.zapLedgerEntry.updateMany({
    where: {
      betId: part.betId,
      userId: part.userId,
      kind: { in: ["payout", "refund", "dev_fee"] },
      zapRequestId: zr.id,
    },
    data: { zapReceiptId: receipt.id },
  });
}
