import { SimplePool, nip19, nip57, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { getStorePubkey, publishSettleNote } from "./nostr-server";
import { notifyOperationalError, notifyNonSocialZap } from "./discord";
import { publishNgpBetState, isUnlistedBet } from "./ngp-bet-state";
import { BET_SETTLE_NOTE_MIN_POT_SATS } from "./escrow-v2-config";
import { msatToSats } from "./money";

const MISSING_RECEIPT_GRACE_MS = 10 * 60_000;
// Cierre definitivo: si tras esta ventana el wallet del ganador no publicó su
// 9735, se deja de esperar y el payout se DEGRADA a `lnurl` (pago plano, tier
// "zap no social" de la spec §8 — el dinero ya se pagó; solo falta el anclaje
// social). Sin este cierre, el pendiente vivía para siempre y la alerta de
// Discord se repetía cada 30 min hasta el fin de los tiempos.
const MISSING_RECEIPT_FINAL_MS = 6 * 60 * 60_000;

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
      npub: true,
      payoutZapRequestId: true,
      payoutMsat: true,
      pubkey: true,
      createdAt: true,
      settledAt: true,
      bet: {
        select: {
          anchorEventId: true,
          anchorEventKind: true,
          resultEventId: true,
          resultEventKind: true,
          stakeMsat: true,
          metadataJson: true,
          ngeUnlisted: true,
          _count: { select: { participants: true } },
        },
      },
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
  const finalBefore = Date.now() - MISSING_RECEIPT_FINAL_MS;
  for (const part of pending) {
    if (!part.payoutZapRequestId || resolvedRequestIds.has(part.payoutZapRequestId)) continue;
    const payoutTime = (part.settledAt ?? part.createdAt).getTime();
    if (payoutTime > staleBefore) continue;

    // Cierre definitivo: el wallet del ganador no publica recibos. El pago ya
    // salió (el 9734 firmado queda como auditoría interna); degradamos el tier a
    // `lnurl` para que el pendiente no viva para siempre (ni la alerta se repita
    // cada 30 min) y el 31340 refleje el tier real del payout.
    if (payoutTime < finalBefore) {
      await prisma.zapBetParticipant.update({
        where: { id: part.id },
        data: { payoutKind: "lnurl" },
      });
      void publishNgpBetState(part.betId);
      await notifyNonSocialZap({
        flow: "payout al ganador (cerrado sin recibo)",
        reason:
          "Pasaron 6 h sin recibo kind:9735 del receptor: se deja de esperar. El pago salió bien; queda registrado como LNURL plano (tier no social). No se vuelve a alertar por este payout.",
        fingerprint: `zap-bet-sync:final:${part.id}`,
        cooldownMs: 24 * 60 * 60_000,
        context: {
          betId: part.betId,
          participantId: part.id,
          recipientPubkey: part.pubkey,
          payoutZapRequestId: part.payoutZapRequestId,
          waitingMinutes: Math.floor((Date.now() - payoutTime) / 60_000),
        },
      });
      continue;
    }

    await notifyNonSocialZap({
      flow: "payout al ganador (recibo faltante)",
      reason:
        "El payout se pagó como zap NIP-57 pero el recibo kind:9735 del receptor no aparece en los relays tras la ventana de gracia. Puede que el wallet del ganador no publique recibos: el pago no se ve como zap social en Nostr. Si a las 6 h sigue sin recibo, se cierra solo como LNURL plano.",
      fingerprint: `zap-bet-sync:missing:${part.id}`,
      // Un solo aviso por payout: el próximo mensaje sobre este caso es el cierre
      // definitivo (fingerprint `zap-bet-sync:final:`), no una repetición.
      cooldownMs: MISSING_RECEIPT_FINAL_MS,
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

type PendingPayoutBet = {
  anchorEventId: string | null;
  anchorEventKind: number | null;
  resultEventId: string | null;
  resultEventKind: number | null;
  stakeMsat: bigint;
  metadataJson: string | null;
  _count: { participants: number };
};

type PendingPayout = {
  id: string;
  betId: string;
  userId: string;
  npub: string;
  pubkey: string;
  payoutMsat: bigint | null;
  payoutZapRequestId: string | null;
  bet: PendingPayoutBet;
};

async function recordPayoutReceipt(
  receipt: Event,
  byRequestId: Map<string, PendingPayout>,
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
  byRequestId.delete(zr.id);

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
  void publishPayoutProofNote(part, receipt).catch((error) => {
    void notifyOperationalError({
      source: "zap-bet-sync-proof-note",
      error,
      fingerprint: `zap-bet-sync-proof-note:${part.betId}:${receipt.id}`,
      context: { betId: part.betId, receiptId: receipt.id },
    });
  });
  return zr.id;
}

function nostrEventRef(id: string, kind?: number): string {
  return `nostr:${nip19.neventEncode({ id, relays: RELAYS.slice(0, 3), kind })}`;
}

async function publishPayoutProofNote(
  part: PendingPayout,
  receipt: Event,
): Promise<void> {
  const anchor = part.bet.anchorEventId;
  if (!anchor || anchor.startsWith("dev-anchor-")) return;
  // Mismas reglas EDITORIALES que la nota de liquidación (escrow-v2-settle):
  // sin nota para apuestas unlisted ni para pozos bajo el umbral. La auditoría
  // máquina no se pierde: el recibo ya quedó en el 31340 re-publicado.
  if (isUnlistedBet(part.bet)) return;
  const potSats = Number(msatToSats(part.bet.stakeMsat)) * part.bet._count.participants;
  if (potSats < BET_SETTLE_NOTE_MIN_POT_SATS) return;

  const lines = [
    "🌑 Pago confirmado — Luna Negra",
    `Apuesta: ${part.betId}`,
    `Ganador: ${part.npub}`,
    `Monto: ${part.payoutMsat != null ? Number(msatToSats(part.payoutMsat)) : "?"} sats`,
    `Contrato: ${nostrEventRef(anchor, part.bet.anchorEventKind ?? 1)}`,
    part.bet.resultEventId
      ? `Resultado firmado: ${nostrEventRef(part.bet.resultEventId, part.bet.resultEventKind ?? 30078)}`
      : null,
    `Prueba de pago (recibo 9735): ${nostrEventRef(receipt.id, 9735)}`,
    part.payoutZapRequestId ? `Zap request firmado por Luna: ${part.payoutZapRequestId}` : null,
  ].filter((line): line is string => Boolean(line));

  await publishSettleNote(lines.join("\n"), [
    ["t", "lunanegra:payout-proof:v2"],
    ["bet", part.betId],
    ["e", anchor],
    ["p", part.pubkey],
    ["receipt", receipt.id],
    ...(part.bet.resultEventId ? [["result", part.bet.resultEventId]] : []),
  ]);
}
