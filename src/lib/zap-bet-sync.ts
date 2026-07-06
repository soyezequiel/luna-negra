import { SimplePool, nip57, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { getStorePubkey } from "./nostr-server";
import { notifyOperationalError, notifyNonSocialZap } from "./discord";
import { publishNgpBetState } from "./ngp-bet-state";

const MISSING_RECEIPT_GRACE_MS = 10 * 60_000;

/**
 * Reconciliación de recibos de PAYOUT de apuestas v2. Cuando Luna Negra zapea al
 * ganador (payoutKind = "zap"), el recibo 9735 lo emite el wallet del RECEPTOR, no
 * la tienda: aparece en relays de forma asincrónica. Este sync lo levanta y
 * completa `payoutReceiptId` (+ el `zapReceiptId` del asiento del ledger), cerrando
 * la auditoría del zap saliente sin bloquear el pago (que ya se hizo).
 *
 * Es un espejo ACOTADO de zap-sync.ts: mismo patrón de pool + querySync + dedup.
 * Los payouts salen como profile-zaps (`p` = receptor, sin `e`), así que
 * buscamos por el receptor y el matching fuerte es el 9734 que FIRMAMOS nosotros
 * (su id == payoutZapRequestId).
 * El scheduler vive en src/instrumentation.ts.
 */

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

export async function syncZapBetReceipts(): Promise<void> {
  const storePubkey = getStorePubkey();
  if (!storePubkey) {
    await notifyOperationalError({
      source: "zap-bet-sync-config",
      error: new Error("Falta LUNA_NEGRA_NSEC: no se pueden auditar payouts por zap"),
      fingerprint: "zap-bet-sync:missing-store-key",
      cooldownMs: 60 * 60_000,
    });
    return;
  }

  // Participantes con payout por zap todavía sin recibo.
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
      pubkey: true,
      createdAt: true,
      settledAt: true,
    },
  });
  if (pending.length === 0) return;

  // Índice: 9734 que firmamos (payoutZapRequestId) → participante.
  const byRequestId = new Map<string, (typeof pending)[number]>();
  const recipientPubkeys = new Set<string>();
  let since = Math.floor(Date.now() / 1000);
  for (const p of pending) {
    if (p.payoutZapRequestId) byRequestId.set(p.payoutZapRequestId, p);
    if (/^[a-f0-9]{64}$/.test(p.pubkey)) recipientPubkeys.add(p.pubkey);
    const ts = Math.floor((p.settledAt ?? p.createdAt).getTime() / 1000) - 60 * 60;
    if (ts < since) since = ts;
  }
  if (recipientPubkeys.size === 0) return;

  let receipts: Event[];
  try {
    receipts = await pool().querySync(
      RELAYS,
      { kinds: [9735], "#p": [...recipientPubkeys], since },
      { maxWait: 5000 },
    );
  } catch (error) {
    await notifyOperationalError({
      source: "zap-bet-sync-relays",
      error,
      fingerprint: "zap-bet-sync:relay-query",
      cooldownMs: 10 * 60_000,
      context: { pendingPayouts: pending.length, relays: RELAYS },
    });
    return; // relays caídos: reintentamos en el próximo tick
  }

  const resolvedRequestIds = new Set<string>();
  for (const receipt of receipts) {
    try {
      const requestId = await recordPayoutReceipt(receipt, byRequestId, storePubkey);
      if (requestId) resolvedRequestIds.add(requestId);
    } catch (error) {
      await notifyOperationalError({
        source: "zap-bet-sync-database",
        error,
        fingerprint: `zap-bet-sync:receipt:${receipt.id}`,
        context: { receiptId: receipt.id },
      });
    }
  }

  const staleBefore = Date.now() - MISSING_RECEIPT_GRACE_MS;
  for (const part of pending) {
    if (!part.payoutZapRequestId || resolvedRequestIds.has(part.payoutZapRequestId)) continue;
    const payoutTime = (part.settledAt ?? part.createdAt).getTime();
    if (payoutTime > staleBefore) continue;
    await notifyNonSocialZap({
      flow: "payout al ganador (recibo faltante)",
      reason:
        "El payout se pagó como zap NIP-57 pero el recibo kind:9735 del receptor no aparece en los relays tras la ventana de gracia. Puede que el wallet del ganador no publique recibos: el pago no se ve como zap social en Nostr.",
      fingerprint: `zap-bet-sync:missing:${part.id}`,
      cooldownMs: 30 * 60_000,
      context: {
        betId: part.betId,
        participantId: part.id,
        recipientPubkey: part.pubkey,
        payoutZapRequestId: part.payoutZapRequestId,
        waitingMinutes: Math.floor((Date.now() - payoutTime) / 60_000),
      },
    });
  }
}

async function recordPayoutReceipt(
  receipt: Event,
  byRequestId: Map<string, { id: string; betId: string; userId: string; pubkey: string }>,
  storePubkey: string,
): Promise<string | null> {
  if (receipt.kind !== 9735) return null;

  // El 9734 embebido (description) es el que FIRMAMOS nosotros para pagar el zap.
  const desc = receipt.tags.find((t) => t[0] === "description")?.[1];
  if (!desc || nip57.validateZapRequest(desc)) return null;

  let zr: { id?: string; pubkey?: string };
  try {
    zr = JSON.parse(desc);
  } catch {
    return null;
  }
  // Debe estar firmado por la tienda y su id debe corresponder a un payout pendiente.
  if (zr.pubkey !== storePubkey || !zr.id) return null;
  const part = byRequestId.get(zr.id);
  if (!part) return null;
  const recipient = receipt.tags.find((t) => t[0] === "p")?.[1];
  if (recipient !== part.pubkey) return null;

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
  // Estado NGP: el 31340 es addressable, así que re-publicarlo enriquece el
  // estado terminal con el recibo del payout recién llegado (fire-and-forget).
  void publishNgpBetState(part.betId);
  return zr.id;
}
