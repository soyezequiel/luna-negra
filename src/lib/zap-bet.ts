import { createHash, randomBytes } from "node:crypto";
import { nip57, verifyEvent, type Event } from "nostr-tools";
import { finalizeEvent } from "nostr-tools/pure";
import { decryptSecret } from "@/lib/crypto-vault";
import type { ZapBet, ZapBetParticipant } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RELAYS } from "@/lib/constants";
import {
  createDescriptionHashInvoice,
  createInvoice,
  isInvoicePaid,
  lightningConfigured,
} from "@/lib/lightning";
import {
  buildUnsignedZapRequest,
  decodeLnurl,
  encodeLnurl,
  type UnsignedZapRequest,
} from "@/lib/zap";
import {
  getStorePubkey,
  publishZapReceipt,
  republishEvent,
} from "@/lib/nostr-server";
import { recordDepositV2 } from "@/lib/ledger-v2";
import { prewarmPayoutDestinations } from "@/lib/escrow-payout";
import { RESOLVE_WINDOW_MS } from "@/lib/escrow-v2-config";
import { emitDepositReceivedV2, emitBetFundedV2 } from "@/lib/webhooks";
import { msatToSats } from "@/lib/money";
import { STORE_LNURL_USERNAME, storeLnurlUrl } from "@/lib/site-url";
import { notifyBetPaymentDiagnostic, notifyNonSocialZap } from "@/lib/discord";
import { publishNgpBetState } from "@/lib/ngp-bet-state";

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
  // El tag `lnurl` lo arma el CLIENTE del depósito (en NGP eventos, el propio juego
  // desde SU base URL configurada). No exigimos igualdad exacta contra nuestro
  // `siteUrl`: un host alterno que igual enruta a esta tienda (www, otro host del
  // túnel) o un http/https distinto rechazaría TODOS los depósitos. Alcanza con que
  // decodifique a una de nuestras RUTAS LNURL (tienda o participante) — el pago real
  // va al callback HTTP, no a este tag, así que la ruta es lo que importa acá.
  const lnurlOk = baseUrl ? lnurlTargetsStore(tagValue(signed, "lnurl"), part.id) : true;
  const ok =
    Number.isInteger(amountMsat) &&
    BigInt(amountMsat) === bet.stakeMsat &&
    tagValue(signed, "p") === storePubkey &&
    (anchorIsReal ? tagValue(signed, "e") === anchor : true) &&
    lnurlOk;
  return ok ? { ok: true } : { ok: false, error: "El zap request no coincide con la apuesta" };
}

const STORE_LNURL_PATH = `/.well-known/lnurlp/${STORE_LNURL_USERNAME}`;

/**
 * ¿El tag `lnurl` del 9734 apunta a una ruta LNURL de esta tienda (la del store o la
 * de un participante)? Compara por PATHNAME, no por URL exacta: el host y el esquema
 * pueden diferir entre lo que configuró el juego y el `siteUrl` de la tienda sin que
 * el depósito deje de ser legítimo. No abre un vector de robo: los otros checks
 * (`p`, `e`, monto, firmante) siguen atando el zap al contrato, y el dinero va al
 * callback HTTP real, no a lo que diga este tag.
 */
function lnurlTargetsStore(requestLnurl: string | undefined, partId: string): boolean {
  if (!requestLnurl) return false;
  let path: string;
  try {
    path = new URL(decodeLnurl(requestLnurl)).pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
  return path === STORE_LNURL_PATH || path === `/api/v2/lnurlp/${partId}`;
}

type UnsignedComment = { kind: 1111; created_at: number; tags: string[][]; content: string };

/**
 * Arma el COMENTARIO de participación (kind:1111, NIP-22) SIN firmar sobre el
 * evento del contrato, que el jugador firma con su propia identidad al depositar.
 * El payout del ganador se zapea a ESTE comentario (`e`), no al post.
 *
 * Se usa kind:1111 (no kind:1) A PROPÓSITO: es el kind correcto de NIP-22 para
 * comentar eventos que no son notas (nuestra raíz puede ser un kind:1 de la tienda
 * o un kind:1339 de NGP), y —lo clave para el usuario— los clientes NO lo muestran
 * en las pestañas "Notas"/"Respuestas" del perfil, así el perfil del apostador no
 * se llena de respuestas redundantes. El evento sigue siendo público y zapeable, o
 * sea la mecánica de anclar el premio al comentario del ganador queda intacta.
 *
 * Tags NIP-22: scope raíz en MAYÚSCULAS (`E`/`K`/`P`) y padre en minúsculas
 * (`e`/`k`/`p`); como es un comentario de primer nivel, padre == raíz. `K` es el
 * kind de la raíz (`anchorEventKind`, 1 por defecto; 1339 en NGP puro P2P).
 *
 * Null si el ancla no es real (dev-anchor) o no hay identidad de tienda: en ese
 * caso el flujo sigue sin comentario y el premio cae al post (retrocompatibilidad).
 */
export function buildParticipationComment(bet: ZapBet): UnsignedComment | null {
  const anchor = bet.anchorEventId;
  if (!anchor || anchor.startsWith("dev-anchor-")) return null;
  const storePubkey = getStorePubkey();
  if (!storePubkey) return null;
  const sats = Number(msatToSats(bet.stakeMsat));
  const relay = RELAYS[RELAYS.length - 1];
  const rootKind = String(bet.anchorEventKind ?? 1);
  return {
    kind: 1111,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["E", anchor, relay, storePubkey],
      ["K", rootKind],
      ["P", storePubkey],
      ["e", anchor, relay, storePubkey],
      ["k", rootKind],
      ["p", storePubkey],
    ],
    content: `🌑 Entro a esta apuesta con ${sats} sats. ¡Que gane el mejor! ⚡`,
  };
}

/**
 * Valida el comentario de participación firmado por el jugador: firma válida,
 * kind 1111 (comentario NIP-22), autor == participante y referencia (`e`/`E`) el
 * ancla del contrato. No exige el conjunto exacto de tags NIP-22 (distintos
 * signers lo arman distinto), solo que apunte al evento del contrato.
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
  if (signed.kind !== 1111) return { ok: false, error: "El comentario debe ser kind:1111" };
  if (signed.pubkey !== part.pubkey) {
    return { ok: false, error: "El comentario no está firmado por el participante" };
  }
  if (!signed.tags.some((t) => (t[0] === "e" || t[0] === "E") && t[1] === anchor)) {
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

  const zapReqJson = signedZapRequest ? JSON.stringify(signedZapRequest) : null;

  // Reuso idempotente: si ya hay invoice vigente, se devuelve ESE y NO se toca el
  // 9734 guardado — el invoice está comprometido a su description_hash; pisarlo
  // con un 9734 nuevo rompería la verificación del recibo 9735.
  const storedIsDevPlaceholder = part.depositInvoice?.startsWith("lnbc-dev-") ?? false;
  if (part.depositInvoice && part.depositPaymentHash && (devMode || !storedIsDevPlaceholder)) {
    void notifyBetPaymentDiagnostic({
      source: "luna-zap-bet",
      stage: "invoice-reused",
      fingerprint: `invoice-reused:${part.id}:${part.depositPaymentHash}`,
      context: {
        betId: bet.id,
        participantId: part.id,
        anchorEventId: bet.anchorEventId,
        paymentHash: part.depositPaymentHash,
        devMode,
        hasZapRequest: Boolean(part.depositZapRequest),
      },
    });
    return { invoice: part.depositInvoice, paymentHash: part.depositPaymentHash, devMode };
  }

  const sats = Number(msatToSats(bet.stakeMsat));
  if (!zapReqJson && !devMode) {
    throw new Error("Falta el zap request firmado para emitir el invoice NIP-57");
  }
  const descriptionHash = zapReqJson
    ? createHash("sha256").update(zapReqJson).digest("hex")
    : null;
  const invoiceStartedAt = Date.now();
  const inv = devMode
    ? {
        invoice: `lnbc-dev-${randomBytes(12).toString("hex")}`,
        paymentHash: `dev-${randomBytes(16).toString("hex")}`,
      }
    : await createDescriptionHashInvoice(sats, descriptionHash!);
  const invoiceElapsedMs = Date.now() - invoiceStartedAt;

  // Claim ATÓMICO: solo persiste si nadie emitió antes (o si lo guardado es un
  // placeholder dev que ahora sí se puede reemplazar). Dos pedidos concurrentes
  // —p. ej. el pre-fetch post-create y el primer GET de detalle— firman 9734
  // distintos e invoices distintos; si ambos escribieran, el jugador podría pagar
  // un bolt11 que ya no es el guardado y el depósito nunca se detectaría. El 9734
  // viaja en el MISMO update para que description_hash e invoice queden siempre
  // consistentes; el perdedor descarta el suyo y devuelve el del ganador.
  const claimed = await prisma.zapBetParticipant.updateMany({
    where: {
      id: part.id,
      OR: [{ depositPaymentHash: null }, { depositPaymentHash: { startsWith: "dev-" } }],
    },
    data: {
      depositInvoice: inv.invoice,
      depositPaymentHash: inv.paymentHash,
      ...(zapReqJson ? { depositZapRequest: zapReqJson } : {}),
    },
  });
  if (claimed.count !== 1) {
    const fresh = await prisma.zapBetParticipant.findUnique({
      where: { id: part.id },
      select: { depositInvoice: true, depositPaymentHash: true },
    });
    if (fresh?.depositInvoice && fresh.depositPaymentHash) {
      void notifyBetPaymentDiagnostic({
        source: "luna-zap-bet",
        stage: "invoice-lost-race",
        fingerprint: `invoice-lost-race:${part.id}:${fresh.depositPaymentHash}`,
        context: {
          betId: bet.id,
          participantId: part.id,
          anchorEventId: bet.anchorEventId,
          paymentHash: fresh.depositPaymentHash,
          invoiceElapsedMs,
          devMode,
        },
      });
      return { invoice: fresh.depositInvoice, paymentHash: fresh.depositPaymentHash, devMode };
    }
    throw new Error("No se pudo persistir el invoice de depósito; reintentá");
  }

  void notifyBetPaymentDiagnostic({
    source: "luna-zap-bet",
    stage: "invoice-issued",
    fingerprint: `invoice-issued:${part.id}:${inv.paymentHash}`,
    context: {
      betId: bet.id,
      participantId: part.id,
      anchorEventId: bet.anchorEventId,
      paymentHash: inv.paymentHash,
      stakeSats: sats,
      invoiceElapsedMs,
      devMode,
      hasZapRequest: Boolean(zapReqJson),
    },
  });

  return { invoice: inv.invoice, paymentHash: inv.paymentHash, devMode };
}

/**
 * Depósito NGE v2: invoice BOLT11 PLANO del nodo de la tienda (sin zap/9734 ni clave
 * custodial). Cualquier participante —una cuenta real (NIP-07/46) o un invitado— paga
 * este bolt11 y el pago se detecta por su `paymentHash` (`checkAndSettleDepositV2`),
 * igual que el depósito-zap. Al no exigir firma custodial, el asiento puede ser la
 * CUENTA REAL del jugador (no un invitado efímero): así la apuesta le pertenece
 * (aparece en su `/bets`) y el premio va a su lud16. Idempotente: reusa el invoice
 * vigente (claim atómico, mismo criterio que `ensureDepositInvoiceV2`).
 */
export async function ensurePlainDepositInvoiceV2(
  bet: ZapBet,
  part: ZapBetParticipant,
): Promise<DepositInvoiceV2> {
  const devMode = !lightningConfigured();
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
    : await createInvoice(sats, `Luna Negra — depósito apuesta ${bet.id}`);

  // Claim atómico: solo persiste si nadie emitió antes (o si lo guardado es un
  // placeholder dev). Dos pedidos concurrentes (create + primer get_bet) emitirían
  // invoices distintos; el perdedor descarta el suyo y devuelve el del ganador.
  const claimed = await prisma.zapBetParticipant.updateMany({
    where: {
      id: part.id,
      OR: [{ depositPaymentHash: null }, { depositPaymentHash: { startsWith: "dev-" } }],
    },
    data: { depositInvoice: inv.invoice, depositPaymentHash: inv.paymentHash },
  });
  if (claimed.count !== 1) {
    const fresh = await prisma.zapBetParticipant.findUnique({
      where: { id: part.id },
      select: { depositInvoice: true, depositPaymentHash: true },
    });
    if (fresh?.depositInvoice && fresh.depositPaymentHash) {
      return { invoice: fresh.depositInvoice, paymentHash: fresh.depositPaymentHash, devMode };
    }
    throw new Error("No se pudo persistir el invoice de depósito; reintentá");
  }
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
  // Telemetría: quién detectó el pago ("poll" on-demand del GET vs "tick" de
  // escrow). Si en los logs los depósitos aparecen confirmados por "tick", el
  // camino on-demand está fallando y la detección se siente lenta.
  source: "poll" | "tick" | "webhook" = "poll",
): Promise<void> {
  if (!part.depositPaymentHash) return;

  // 0) Claim atómico pending → paid ANTES de tocar Nostr. Sin esto, el poll
  //    on-demand (checkAndSettleDepositV2) y el tick de escrow pueden entrar los
  //    dos para el mismo depósito y publicar cada uno su propio recibo 9735
  //    (mismo bolt11, dos eventos distintos): solo el ganador del claim sigue.
  //    De paso evita el doble asiento en el ledger y el doble webhook de
  //    depósito recibido. El tick reintenta el recibo por otra vía (bloque G,
  //    republicando el evento ya guardado, que es idempotente por id).
  const claimed = await prisma.zapBetParticipant.updateMany({
    where: { id: part.id, depositStatus: "pending" },
    data: { depositStatus: "paid", paidAt: now },
  });
  if (claimed.count !== 1) return; // otro proceso ya lo settleó
  console.log(`[escrow-v2] depósito ${part.id} (bet ${bet.id}) confirmado vía ${source}`);
  void notifyBetPaymentDiagnostic({
    source: "luna-zap-bet",
    stage: "deposit-settled",
    fingerprint: `deposit-settled:${part.id}:${part.depositPaymentHash}`,
    context: {
      betId: bet.id,
      participantId: part.id,
      anchorEventId: bet.anchorEventId,
      paymentHash: part.depositPaymentHash,
      detectionSource: source,
      sinceParticipantCreatedMs: now.getTime() - part.createdAt.getTime(),
      stakeMsat: bet.stakeMsat,
      hasInvoice: Boolean(part.depositInvoice),
      hasZapRequest: Boolean(part.depositZapRequest),
    },
  });

  // 1) Recibo 9735 propio (best-effort; si 0 relays, el tick lo reintenta).
  //    Se lanza SIN await para publicarlo en paralelo con el comentario (1.5):
  //    son eventos independientes y cada publicación puede tardar hasta su
  //    timeout; en serie sumaban dentro del poll que detecta el pago.
  let depositReceiptId: string | null = null;
  let depositReceiptJson: string | null = null;
  let depositReceiptOk = false;
  let receiptFailure: unknown = null;
  const receiptTask = (async () => {
    if (!bet.anchorEventId || bet.anchorEventId.startsWith("dev-anchor-") || !part.depositInvoice) {
      return;
    }
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
  })();

  // 1.5) Publicar el COMENTARIO de participación firmado por el jugador (lo mandó
  //      al pedir el invoice). Al pagarse, queda visible como reply del contrato y
  //      el payout del ganador se ancla a él. Best-effort: si 0 relays, el tick lo
  //      reintenta (commentEventOk=false) y mientras tanto el premio cae al post.
  let commentEventId: string | null = part.commentEventId;
  let commentEventOk = part.commentEventOk;
  const commentTask = (async () => {
    if (
      commentEventOk ||
      !part.commentEventJson ||
      !bet.anchorEventId ||
      bet.anchorEventId.startsWith("dev-anchor-")
    ) {
      return;
    }
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
  })();

  await Promise.all([receiptTask, commentTask]);

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

  // 2) Persistir los artefactos Nostr (recibo + comentario). El estado (paid) ya
  //    lo tomamos en el claim inicial; acá solo escribimos lo que produjimos como
  //    ganadores del claim. `depositReceiptId` es @unique y solo lo setea el
  //    ganador, así que no hay colisión.
  await prisma.zapBetParticipant.update({
    where: { id: part.id },
    data: {
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
  // Estado NGP: el depósito nuevo queda visible en el 31340 (fire-and-forget).
  void publishNgpBetState(bet.id);
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
    // Precalentar el destino del premio de cada participante (lee el kind:0 y
    // cachea el lud16): cuando el juego reporte al ganador, la liquidación paga
    // sin esperar a los relays. Fire-and-forget, nunca bloquea el "funded".
    prewarmPayoutDestinations(bet.participants.map((p) => p.npub));
    await emitBetFundedV2(betId);
    // Estado NGP: transición a `funded` (fire-and-forget).
    void publishNgpBetState(betId);
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
