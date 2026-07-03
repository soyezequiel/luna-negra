import { createHash, randomBytes } from "node:crypto";
import { nip57, verifyEvent, type Event } from "nostr-tools";
import { finalizeEvent } from "nostr-tools/pure";
import { decryptSecret } from "@/lib/crypto-vault";
import type { ZapBet, ZapBetParticipant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RELAYS } from "@/lib/constants";
import {
  createDescriptionHashInvoice,
  isInvoicePaid,
  lightningConfigured,
} from "@/lib/lightning";
import {
  buildUnsignedZapRequest,
  encodeLnurl,
  type UnsignedZapRequest,
} from "@/lib/zap";
import {
  getStorePubkey,
  publishZapReceipt,
  republishEvent,
} from "@/lib/nostr-server";
import { recordDepositV2 } from "@/lib/ledger-v2";
import { RESOLVE_WINDOW_MS } from "@/lib/escrow-v2-config";
import { emitDepositReceivedV2, emitBetFundedV2 } from "@/lib/webhooks";
import { msatToSats } from "@/lib/money";
import { storeLnurlUrl } from "@/lib/site-url";
import { notifyNonSocialZap } from "@/lib/discord";

// Depósito por zap (v2). Luna Negra actúa como receptor NIP-57: el apostador firma
// un zap request (9734) con su identidad, la tienda emite el invoice con su NWC,
// detecta el pago (isInvoicePaid, igual que v1) y entonces FIRMA y PUBLICA el
// recibo 9735 propio, anclado al contrato. Todo lo idempotente/anti-insolvencia
// se apoya en el ledger v2 (idénticas garantías que v1).

type SignedZapRequest = {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  id: string;
  sig: string;
};

const tagValue = (ev: SignedZapRequest, name: string): string | undefined =>
  ev.tags.find((t) => t[0] === name)?.[1];

/** URL absoluta del endpoint LNURL-pay de un participante (deriva el `lnurl`). */
export function participantLnurlUrl(baseUrl: string, participantId: string): string {
  return `${baseUrl}/api/v2/lnurlp/${participantId}`;
}

/**
 * Arma el zap request (9734) SIN firmar del depósito de un participante. `p` = la
 * tienda (custodia del pozo), `e` = ancla del contrato, monto = stake fijo,
 * `lnurl` = endpoint estable publicado en el perfil de Luna Negra. Lo firma el
 * cliente con su signer y el callback resuelve el asiento por contrato + pubkey.
 */
export function buildDepositZapRequest(
  bet: ZapBet,
  _part: ZapBetParticipant,
  baseUrl: string,
): UnsignedZapRequest {
  const storePubkey = getStorePubkey();
  if (!storePubkey) throw new Error("La tienda no tiene identidad Nostr configurada");
  if (!bet.anchorEventId) throw new Error("La apuesta no tiene ancla");
  return buildUnsignedZapRequest({
    amountSats: Number(msatToSats(bet.stakeMsat)),
    recipientPubkey: storePubkey,
    eventId: bet.anchorEventId.startsWith("dev-anchor-") ? null : bet.anchorEventId,
    eventKind: 1,
    lnurl: encodeLnurl(storeLnurlUrl(baseUrl)),
  });
}

export type DepositValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Valida el 9734 firmado por el apostador contra el contrato (anti-tampering,
 * mismo esquema que games/[id]/zap/invoice): firma válida, kind 9734, monto ==
 * stake, `p` == tienda, `e` == ancla y el firmante == pubkey del participante
 * (cada uno firma su propio depósito).
 */
export function validateDepositZapRequest(
  bet: ZapBet,
  part: ZapBetParticipant,
  signed: SignedZapRequest,
  baseUrl?: string,
): DepositValidation {
  const invalid = nip57.validateZapRequest(JSON.stringify(signed));
  if (invalid || signed.kind !== 9734) return { ok: false, error: "Zap request inválido" };
  if (signed.pubkey !== part.pubkey) {
    return { ok: false, error: "El zap request no está firmado por el participante" };
  }
  const amountMsat = Number(tagValue(signed, "amount"));
  const storePubkey = getStorePubkey();
  const anchor = bet.anchorEventId;
  const anchorIsReal = !!anchor && !anchor.startsWith("dev-anchor-");
  const requestLnurl = tagValue(signed, "lnurl");
  const allowedLnurls = baseUrl
    ? new Set([
        encodeLnurl(storeLnurlUrl(baseUrl)),
        encodeLnurl(participantLnurlUrl(baseUrl, part.id)),
      ])
    : null;
  const ok =
    Number.isInteger(amountMsat) &&
    BigInt(amountMsat) === bet.stakeMsat &&
    tagValue(signed, "p") === storePubkey &&
    (anchorIsReal ? tagValue(signed, "e") === anchor : true) &&
    (!allowedLnurls || (!!requestLnurl && allowedLnurls.has(requestLnurl)));
  return ok ? { ok: true } : { ok: false, error: "El zap request no coincide con la apuesta" };
}

type UnsignedNote = { kind: 1; created_at: number; tags: string[][]; content: string };

/**
 * Arma el COMENTARIO de participación (kind:1) SIN firmar: un reply NIP-10 al post
 * del contrato (`e` root + `p` = la tienda, autora del contrato) que el jugador
 * firma con su propia identidad al depositar. El payout del ganador se zapea a ESTE
 * comentario (`e`), no al post. Null si el ancla no es real (dev-anchor) o no hay
 * identidad de tienda: en ese caso el flujo sigue sin comentario y el premio cae al
 * post (retrocompatibilidad).
 */
export function buildParticipationComment(bet: ZapBet): UnsignedNote | null {
  const anchor = bet.anchorEventId;
  if (!anchor || anchor.startsWith("dev-anchor-")) return null;
  const storePubkey = getStorePubkey();
  if (!storePubkey) return null;
  const sats = Number(msatToSats(bet.stakeMsat));
  const relay = RELAYS[RELAYS.length - 1];
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", anchor, relay, "root"],
      ["p", storePubkey],
    ],
    content: `🌑 Entro a esta apuesta con ${sats} sats. ¡Que gane el mejor! ⚡`,
  };
}

/**
 * Valida el comentario de participación firmado por el jugador: firma válida,
 * kind 1, autor == participante y referencia (`e`) el ancla del contrato. No
 * exige el marcador NIP-10 exacto (distintos signers lo arman distinto), solo que
 * apunte al post.
 */
export function validateParticipationComment(
  bet: ZapBet,
  part: ZapBetParticipant,
  signed: SignedZapRequest,
): DepositValidation {
  const anchor = bet.anchorEventId;
  if (!anchor || anchor.startsWith("dev-anchor-")) {
    return { ok: false, error: "La apuesta no tiene un ancla real" };
  }
  if (signed.kind !== 1) return { ok: false, error: "El comentario debe ser kind:1" };
  if (signed.pubkey !== part.pubkey) {
    return { ok: false, error: "El comentario no está firmado por el participante" };
  }
  if (!signed.tags.some((t) => t[0] === "e" && t[1] === anchor)) {
    return { ok: false, error: "El comentario no referencia el post de la apuesta" };
  }
  if (!verifyEvent(signed as unknown as Event)) {
    return { ok: false, error: "La firma del comentario es inválida" };
  }
  return { ok: true };
}

export type DepositInvoiceV2 = {
  invoice: string;
  paymentHash: string;
  devMode: boolean;
};

/**
 * Devuelve (creándolo si hace falta) el invoice de depósito de un participante y
 * guarda el 9734 firmado que lo respalda (para el 9735 posterior). Idempotente:
 * reusa el invoice guardado salvo que sea un placeholder dev y ahora haya NWC.
 * Espejo de ensureDepositInvoice (v1): en dev sin NWC genera `lnbc-dev-…`; en
 * producción sin NWC lanza (nunca un QR falso).
 */
export async function ensureDepositInvoiceV2(
  bet: ZapBet,
  part: ZapBetParticipant,
  signedZapRequest?: SignedZapRequest | null,
): Promise<DepositInvoiceV2> {
  const devMode = !lightningConfigured();
  if (devMode && process.env.NODE_ENV === "production") {
    throw new Error(
      "Lightning no está configurado (falta NWC_CONNECTION_STRING). " +
        "No se puede generar el invoice de depósito en producción.",
    );
  }

  // Persistimos el 9734 firmado apenas llega (aunque el invoice ya exista): es la
  // `description` del recibo 9735 que publicaremos al confirmarse el pago.
  const zapReqJson = signedZapRequest ? JSON.stringify(signedZapRequest) : null;
  if (zapReqJson && part.depositZapRequest !== zapReqJson) {
    await prisma.zapBetParticipant.update({
      where: { id: part.id },
      data: { depositZapRequest: zapReqJson },
    });
    part = { ...part, depositZapRequest: zapReqJson };
  }

  const storedIsDevPlaceholder = part.depositInvoice?.startsWith("lnbc-dev-") ?? false;
  if (part.depositInvoice && part.depositPaymentHash && (devMode || !storedIsDevPlaceholder)) {
    return { invoice: part.depositInvoice, paymentHash: part.depositPaymentHash, devMode };
  }

  const sats = Number(msatToSats(bet.stakeMsat));
  if (!zapReqJson && !devMode) {
    throw new Error("Falta el zap request firmado para emitir el invoice NIP-57");
  }
  const descriptionHash = zapReqJson
    ? createHash("sha256").update(zapReqJson).digest("hex")
    : null;
  const inv = devMode
    ? {
        invoice: `lnbc-dev-${randomBytes(12).toString("hex")}`,
        paymentHash: `dev-${randomBytes(16).toString("hex")}`,
      }
    : await createDescriptionHashInvoice(sats, descriptionHash!);

  await prisma.zapBetParticipant.update({
    where: { id: part.id },
    data: { depositInvoice: inv.invoice, depositPaymentHash: inv.paymentHash },
  });

  return { invoice: inv.invoice, paymentHash: inv.paymentHash, devMode };
}

/**
 * Depósito de un participante cuya clave CUSTODIA Luna Negra (invitado efímero o
 * cuenta por email): como no hay firmante propio, Luna firma el 9734 del depósito en
 * su nombre con la clave guardada (`nsecEnc`) y emite el invoice. Así el invitado
 * paga con cualquier wallet/extensión/QR y el depósito sigue siendo un zap NIP-57
 * real (el 9735 lleva su pubkey como emisor). Devuelve el invoice, o `null` si el
 * participante trae clave propia (NIP-07/46) → el cliente lo firma.
 *
 * Idempotente: si el invoice ya está emitido, lo reusa SIN re-firmar (firmar de nuevo
 * cambiaría el 9734 guardado y su hash dejaría de coincidir con el invoice vigente).
 */
export async function ensureCustodialDepositInvoiceV2(
  bet: ZapBet,
  part: ZapBetParticipant & { user?: { nsecEnc: string | null } | null },
  baseUrl: string,
): Promise<DepositInvoiceV2 | null> {
  // Clave custodiada por Luna: la traemos del include si vino, si no la buscamos.
  let nsecEnc = part.user === undefined ? undefined : part.user?.nsecEnc ?? null;
  if (nsecEnc === undefined) {
    const u = await prisma.user.findUnique({
      where: { id: part.userId },
      select: { nsecEnc: true },
    });
    nsecEnc = u?.nsecEnc ?? null;
  }
  if (!nsecEnc) return null; // clave propia → firma el cliente

  const devMode = !lightningConfigured();
  // Reuso idempotente: mismo criterio que ensureDepositInvoiceV2 (no re-firmar).
  const storedIsDevPlaceholder = part.depositInvoice?.startsWith("lnbc-dev-") ?? false;
  if (part.depositInvoice && part.depositPaymentHash && (devMode || !storedIsDevPlaceholder)) {
    return { invoice: part.depositInvoice, paymentHash: part.depositPaymentHash, devMode };
  }

  const unsigned = buildDepositZapRequest(bet, part, baseUrl);
  const sk = decryptSecret(nsecEnc);
  const signed = finalizeEvent(
    { kind: unsigned.kind, created_at: unsigned.created_at, tags: unsigned.tags, content: unsigned.content },
    sk,
  );
  return ensureDepositInvoiceV2(bet, part, signed as unknown as SignedZapRequest);
}

/**
 * Marca el depósito como pagado, registra el asiento en el ledger v2 y — el paso
 * propio de v2 — construye, firma y PUBLICA el recibo 9735 anclado al contrato.
 * Idempotente vía idempotencyKey del ledger. Asume que el invoice ya se verificó.
 */
export async function settleDepositV2(
  bet: ZapBet,
  part: ZapBetParticipant,
  now: Date,
): Promise<void> {
  if (!part.depositPaymentHash) return;

  // 1) Recibo 9735 propio (best-effort; si 0 relays, el tick lo reintenta).
  let depositReceiptId: string | null = null;
  let depositReceiptJson: string | null = null;
  let depositReceiptOk = false;
  let receiptFailure: unknown = null;
  if (bet.anchorEventId && !bet.anchorEventId.startsWith("dev-anchor-") && part.depositInvoice) {
    // Si el apostador firmó su 9734 lo usamos como `description` (identifica al
    // emisor con el tag `P`). Sin firma no publicamos un 9735: los clientes Nostr
    // descartan recibos con `description` sintético/no firmado.
    let signerPubkey: string | null = null;
    let descriptionZapRequest = part.depositZapRequest;
    if (descriptionZapRequest) {
      try {
        signerPubkey = (JSON.parse(descriptionZapRequest) as SignedZapRequest).pubkey ?? null;
      } catch {
        descriptionZapRequest = null;
      }
    }
    if (descriptionZapRequest && signerPubkey) {
      const receipt = await publishZapReceipt({
        anchorEventId: bet.anchorEventId,
        bolt11: part.depositInvoice,
        descriptionZapRequest,
        zapperPubkey: signerPubkey,
      }).catch((error) => {
        receiptFailure = error;
        return null;
      });
      if (receipt) {
        depositReceiptId = receipt.event.id;
        depositReceiptJson = JSON.stringify(receipt.event);
        depositReceiptOk = receipt.accepted > 0;
      }
    } else {
      receiptFailure = new Error("El depósito pagado no conserva un zap request 9734 válido");
    }
  }

  const expectsReceipt = Boolean(
    bet.anchorEventId && !bet.anchorEventId.startsWith("dev-anchor-"),
  );
  if (expectsReceipt && !depositReceiptOk) {
    const failureMsg =
      receiptFailure instanceof Error
        ? receiptFailure.message
        : receiptFailure != null
          ? String(receiptFailure)
          : depositReceiptJson
            ? "Ningún relay aceptó el recibo kind:9735 del depósito"
            : "No se pudo construir el recibo kind:9735 del depósito";
    await notifyNonSocialZap({
      flow: "depósito de apuesta (zap entrante)",
      reason: `El depósito se cobró pero no quedó como zap social: ${failureMsg}. Sin recibo 9735 firmado y aceptado por relays, el aporte no es visible en Nostr.`,
      fingerprint: `zap-deposit-receipt:${part.id}`,
      cooldownMs: 30 * 60_000,
      context: {
        betId: bet.id,
        participantId: part.id,
        anchorEventId: bet.anchorEventId,
        hasInvoice: Boolean(part.depositInvoice),
        hasZapRequest: Boolean(part.depositZapRequest),
        receiptId: depositReceiptId,
      },
    });
  }

  // 1.5) Publicar el COMENTARIO de participación firmado por el jugador (lo mandó
  //      al pedir el invoice). Al pagarse, queda visible como reply del contrato y
  //      el payout del ganador se ancla a él. Best-effort: si 0 relays, el tick lo
  //      reintenta (commentEventOk=false) y mientras tanto el premio cae al post.
  let commentEventId: string | null = part.commentEventId;
  let commentEventOk = part.commentEventOk;
  if (
    !commentEventOk &&
    part.commentEventJson &&
    bet.anchorEventId &&
    !bet.anchorEventId.startsWith("dev-anchor-")
  ) {
    try {
      const ev = JSON.parse(part.commentEventJson) as Event;
      const accepted = await republishEvent(ev);
      if (accepted > 0) {
        commentEventId = ev.id;
        commentEventOk = true;
      }
    } catch {
      /* json corrupto: se ignora; el premio del ganador cae al post del contrato */
    }
  }

  // 2) Estado + ledger. `depositReceiptId` es @unique: si otro proceso ya settleó
  //    (carrera tick/poll), el update podría chocar → lo hacemos condicional.
  await prisma.zapBetParticipant.updateMany({
    where: { id: part.id, depositStatus: "pending" },
    data: {
      depositStatus: "paid",
      paidAt: now,
      depositReceiptId,
      depositReceiptJson,
      depositReceiptOk,
      commentEventId,
      commentEventOk,
    },
  });
  await recordDepositV2({
    betId: bet.id,
    userId: part.userId,
    amountMsat: bet.stakeMsat,
    idempotencyKey: `deposit:${bet.id}:${part.userId}`,
    paymentHash: part.depositPaymentHash,
    zapReceiptId: depositReceiptId,
  });
  await emitDepositReceivedV2(bet.id, part.npub);
}

/**
 * Si la apuesta v2 tiene todos los depósitos pagos, la promueve a `ready`.
 * Claim optimista (evita dobles transiciones). Devuelve true si promovió.
 */
export async function promoteIfAllPaidV2(betId: string, now: Date): Promise<boolean> {
  const bet = await prisma.zapBet.findUnique({
    where: { id: betId },
    include: { participants: true },
  });
  if (!bet || bet.status !== "pending_deposits") return false;
  if (
    bet.participants.length === 0 ||
    !bet.participants.every((p) => p.depositStatus === "paid")
  ) {
    return false;
  }
  const claimed = await prisma.zapBet.updateMany({
    where: { id: betId, status: "pending_deposits" },
    data: {
      status: "ready",
      readyAt: now,
      resolveDeadline: new Date(now.getTime() + RESOLVE_WINDOW_MS),
    },
  });
  if (claimed.count === 1) {
    await emitBetFundedV2(betId);
    return true;
  }
  return false;
}

/**
 * Verificación on-demand del depósito de UN participante (lo llama el GET de
 * estado en cada poll): consulta el invoice y, si está pagado, lo settlea +
 * publica el 9735 + promueve. Devuelve true si recién marcó el depósito.
 */
export async function checkAndSettleDepositV2(participantId: string): Promise<boolean> {
  if (!lightningConfigured()) return false;
  const p = await prisma.zapBetParticipant.findUnique({
    where: { id: participantId },
    include: { bet: true },
  });
  if (
    !p ||
    p.bet.status !== "pending_deposits" ||
    p.depositStatus !== "pending" ||
    !p.depositPaymentHash ||
    p.depositPaymentHash.startsWith("dev-")
  ) {
    return false;
  }
  const paid = await isInvoicePaid(p.depositPaymentHash).catch(() => false);
  if (!paid) return false;

  const now = new Date();
  await settleDepositV2(p.bet, p, now);
  await promoteIfAllPaidV2(p.betId, now);
  return true;
}
