import { bech32 } from "@scure/base";
import { prisma } from "./prisma";
import { resolveTipDestination } from "./tip-destination";
import { RELAYS } from "./constants";

/**
 * Helpers de ZAP (NIP-57) server-side. Convierten la "propina al dev" en un zap
 * real: el usuario firma un zap request (kind 9734) con su identidad Nostr, el
 * wallet del dev emite un recibo público (kind 9735) y de esos recibos sale el
 * "top de zappers" (ver src/lib/zap-sync.ts). Acá vive todo lo que toca al wallet
 * LNURL del dev: resolver su endpoint, armar el 9734 sin firmar y pedir el invoice.
 *
 * El sat va 100% al dev (igual que la propina vieja): Luna Negra nunca custodia
 * el dinero. La única novedad es la capa Nostr encima del LNURL-pay.
 */

export type ZapEndpoint = {
  /** Lightning Address del dev (resuelta por la cascada de tip-destination). */
  address: string;
  /** Callback LNURL-pay donde se pide el invoice. */
  callback: string;
  /** lnurl bech32 (lnurl1…) del endpoint, para el tag/param `lnurl` del zap. */
  lnurl: string;
  /** Pubkey (hex) que firmará el recibo 9735. Se cachea en Game.zapLnurlPubkey. */
  nostrPubkey: string;
  /** Límites del LNURL-pay, en msat. */
  minSendable: number;
  maxSendable: number;
};

// Tope de espera por fetch al LNURL del dev: si su servidor está lento/caído, no
// bloqueamos el render de la ficha ni el endpoint (mismo criterio que nostr.ts).
const FETCH_TIMEOUT_MS = 4000;

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(t);
  }
}

/** `name@domain` → URL del `.well-known/lnurlp`. Null si no es una address válida. */
function lnurlpUrl(address: string): string | null {
  const [name, domain] = address.split("@");
  if (!name || !domain) return null;
  try {
    return new URL(
      `/.well-known/lnurlp/${encodeURIComponent(name)}`,
      `https://${domain}`,
    ).toString();
  } catch {
    return null;
  }
}

/** Codifica una URL LNURL-pay como bech32 (lnurl1…), como pide NIP-57. */
export function encodeLnurl(url: string): string {
  const words = bech32.toWords(new TextEncoder().encode(url));
  // Límite alto: las URLs LNURL superan el default de 90 chars de bech32.
  return bech32.encode("lnurl", words, 2000);
}

/**
 * Resuelve una Lightning Address (`name@domain`) a su `ZapEndpoint` NIP-57, o
 * `null` si el wallet no soporta zaps (sin `allowsNostr`/`nostrPubkey`) o no se
 * pudo contactar. Es la parte agnóstica del destinatario: la usa el zap del dev
 * (vía `resolveZapEndpoint`) y el motor de payouts v2 (que zapea al ganador).
 */
export async function resolveZapEndpointForAddress(
  address: string,
): Promise<ZapEndpoint | null> {
  const url = lnurlpUrl(address);
  if (!url) return null;

  let body: Record<string, unknown>;
  try {
    body = await fetchJson(url);
  } catch {
    return null;
  }

  const callback = body.callback;
  const nostrPubkey = body.nostrPubkey;
  if (
    body.allowsNostr !== true ||
    typeof callback !== "string" ||
    typeof nostrPubkey !== "string" ||
    !/^[a-f0-9]{64}$/.test(nostrPubkey)
  ) {
    return null;
  }

  return {
    address,
    callback,
    lnurl: encodeLnurl(url),
    nostrPubkey,
    minSendable: Number(body.minSendable ?? 1000),
    maxSendable: Number(body.maxSendable ?? 1_000_000_000),
  };
}

/**
 * Resuelve el endpoint de zap del dev de un juego, o `null` si su wallet no
 * soporta zaps NIP-57 (sin `allowsNostr`/`nostrPubkey`) o no se pudo contactar.
 * Cuando devuelve null, NO se ofrece zap (no hay fallback a propina plana).
 */
export async function resolveZapEndpoint(
  providerId: string,
): Promise<ZapEndpoint | null> {
  const address = await resolveTipDestination(providerId);
  if (!address) return null;
  return resolveZapEndpointForAddress(address);
}

export type UnsignedZapRequest = {
  kind: 9734;
  created_at: number;
  content: string;
  tags: string[][];
};

/**
 * Arma el zap request (kind 9734) SIN firmar. Lo firma el cliente con su
 * `LunaSigner` (así "se sabe quién mandó"). No usamos `nip57.makeZapRequest`
 * porque ése pone `p = autor del evento`; acá `p` es el DEV (recipiente del sat)
 * y `e` es el anuncio del juego (firmado por Luna Negra), que son distintos.
 */
export function buildUnsignedZapRequest(opts: {
  amountSats: number;
  comment?: string;
  recipientPubkey: string;
  eventId?: string | null;
  eventKind?: number | null;
  lnurl: string;
  relays?: string[];
}): UnsignedZapRequest {
  const tags: string[][] = [
    ["relays", ...(opts.relays ?? RELAYS)],
    ["amount", String(opts.amountSats * 1000)],
    ["lnurl", opts.lnurl],
    ["p", opts.recipientPubkey],
  ];
  if (opts.eventId) tags.push(["e", opts.eventId]);
  if (opts.eventId && opts.eventKind != null) {
    tags.push(["k", String(opts.eventKind)]);
  }
  return {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    content: opts.comment?.trim() || "",
    tags,
  };
}

/**
 * Pide el invoice (bolt11) al callback LNURL-pay del dev, adjuntando el zap
 * request firmado (param `nostr`). Server-side para esquivar CORS. Devuelve el
 * bolt11; lanza si el servidor del dev no responde un `pr`.
 */
export async function fetchZapInvoice(opts: {
  callback: string;
  amountMsat: number;
  signedZapRequest: string; // JSON del 9734 firmado
  lnurl: string;
}): Promise<string> {
  const u = new URL(opts.callback);
  u.searchParams.set("amount", String(opts.amountMsat));
  u.searchParams.set("nostr", opts.signedZapRequest);
  u.searchParams.set("lnurl", opts.lnurl);
  const body = await fetchJson(u.toString());
  const pr = body.pr;
  if (typeof pr !== "string" || !pr) {
    const reason = typeof body.reason === "string" ? body.reason : null;
    throw new Error(reason ?? "El wallet del dev no devolvió un invoice");
  }
  return pr;
}

// --- Contexto de zap de un juego (gating + caché del firmante) ---

export type ZapContext = {
  gameId: string;
  providerId: string;
  /** Pubkey del dev: recipiente del sat (tag `p` del zap request). */
  recipientPubkey: string;
  /** Anuncio del juego en Nostr: lo zapeamos (tag `e`) para atribuirlo al juego. */
  eventId: string;
  endpoint: ZapEndpoint;
};

export type ZapContextError =
  | "not_found" // juego inexistente o no publicado
  | "not_free" // sólo los juegos gratis ofrecen zap (contexto propina)
  | "no_announcement" // sin anuncio Nostr no hay `e` con qué anclar/atribuir
  | "no_zap_support"; // el wallet del dev no soporta zaps NIP-57

/**
 * Carga el contexto de zap de un juego aplicando el gating (gratis + anuncio +
 * soporte NIP-57) y cacheando en `Game.zapLnurlPubkey` el firmante del recibo,
 * que la reconciliación (zap-sync.ts) usa para validar los 9735. Devuelve el
 * contexto o un código de error que las rutas mapean a HTTP.
 */
export async function loadZapContext(
  gameId: string,
): Promise<ZapContext | ZapContextError> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      providerId: true,
      priceSats: true,
      status: true,
      nostrEventId: true,
      zapLnurlPubkey: true,
      provider: { select: { owner: { select: { pubkey: true } } } },
    },
  });
  if (!game || game.status !== "published") return "not_found";
  if (game.priceSats !== 0) return "not_free";
  if (!game.nostrEventId) return "no_announcement";

  const endpoint = await resolveZapEndpoint(game.providerId);
  if (!endpoint) return "no_zap_support";

  // Cacheamos el firmante del LNURL si cambió (best-effort; no bloquea el zap).
  if (game.zapLnurlPubkey !== endpoint.nostrPubkey) {
    await prisma.game
      .update({
        where: { id: game.id },
        data: { zapLnurlPubkey: endpoint.nostrPubkey },
      })
      .catch(() => {});
  }

  return {
    gameId: game.id,
    providerId: game.providerId,
    recipientPubkey: game.provider.owner.pubkey,
    eventId: game.nostrEventId,
    endpoint,
  };
}

/** Mensajes de usuario para cada error de gating (rutas y UI server-side). */
export const ZAP_CONTEXT_MESSAGE: Record<ZapContextError, string> = {
  not_found: "Juego no encontrado",
  not_free: "El zap como propina sólo aplica a juegos gratis",
  no_announcement: "Este juego todavía no tiene anuncio en Nostr",
  no_zap_support:
    "Este desarrollador todavía no configuró un wallet con zaps (NIP-57)",
};
