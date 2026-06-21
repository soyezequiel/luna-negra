import type { Bet } from "@prisma/client";
import { createHmac, randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { msatToSats } from "@/lib/money";
import { recordIntegration } from "@/lib/integration-telemetry";

// Webhooks salientes: notifican al proveedor (compra, apuesta, payout).
// Firmados con HMAC-SHA256 usando el secreto del proveedor. Entrega vía QStash
// (reintentos) si hay QSTASH_TOKEN; si no, fetch directo (dev). Best-effort.

export function generateWebhookSecret(): string {
  return "whsec_" + randomBytes(24).toString("base64url");
}

/**
 * ¿Es una URL de webhook segura para que Luna Negra le haga POST? Bloquea
 * destinos internos (loopback, rangos privados, link-local — incluida la IP de
 * metadata 169.254.169.254) para mitigar SSRF, y exige https en producción.
 * El proveedor controla esta URL, así que el chequeo se hace al guardarla.
 */
export function isAllowedWebhookUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:") {
    return false;
  }

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // quita [] de IPv6

  // Hostnames y literales IPv6 internos.
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::1" || host === "::") return false;
  if (host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) {
    return false; // link-local / unique-local IPv6
  }

  // Literales IPv4 en rangos no enrutables/privados.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return false; // this-host / privado / loopback
    if (a === 169 && b === 254) return false; // link-local (metadata cloud)
    if (a === 172 && b >= 16 && b <= 31) return false; // privado
    if (a === 192 && b === 168) return false; // privado
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  }
  return true;
}

/** Patch de Prisma para `provider.webhookUrl` / `webhookSecret`. */
export type WebhookUpdate = {
  webhookUrl: string | null;
  webhookSecret?: string | null;
};

/**
 * Resuelve la config de webhook a aplicar (compartido entre la ruta de sesión y
 * la ruta v1 por API key). Devuelve el patch de Prisma, o `null` si la URL es
 * inválida (no empieza con http(s)://).
 *
 * Semántica:
 *  - URL vacía/ausente ⇒ borra `webhookUrl` y `webhookSecret`.
 *  - `regenerate === true` o sin secreto previo ⇒ genera un secreto nuevo
 *    (rotarlo invalida el anterior).
 *  - URL válida con secreto existente y sin `regenerate` ⇒ conserva el secreto.
 */
export function buildWebhookUpdate(
  rawUrl: unknown,
  opts: { regenerate?: boolean; currentSecret: string | null },
): WebhookUpdate | null {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (url && !isAllowedWebhookUrl(url)) return null; // URL inválida o destino interno
  const data: WebhookUpdate = { webhookUrl: url || null };
  if (!url) {
    data.webhookSecret = null; // sin URL, no hace falta secreto
  } else if (opts.regenerate === true || !opts.currentSecret) {
    data.webhookSecret = generateWebhookSecret();
  }
  return data;
}

export function signWebhook(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export type WebhookType =
  | "purchase.completed"
  | "payout.sent"
  | "bet.settled"
  | "deposit.received"
  | "bet.funded"
  | "bet.cancelled"
  | "bet.expired"
  | "bet.refunded";

async function deliver(
  providerId: string,
  type: WebhookType,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { webhookUrl: true, webhookSecret: true },
    });
    if (!provider?.webhookUrl || !provider.webhookSecret) return;

    const payload = {
      id: randomUUID(),
      type,
      created: new Date().toISOString(),
      data,
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-LunaNegra-Event": type,
      "X-LunaNegra-Signature": signWebhook(body, provider.webhookSecret),
    };

    const token = process.env.QSTASH_TOKEN;
    if (token) {
      const { Client } = await import("@upstash/qstash");
      await new Client({ token }).publishJSON({
        url: provider.webhookUrl,
        body: payload,
        headers,
      });
    } else {
      // Sin QStash (dev): entrega directa best-effort.
      await fetch(provider.webhookUrl, { method: "POST", headers, body });
    }
    // La entrega se cursó (directo o encolado en QStash): el proveedor tiene el
    // webhook cableado. Registramos la telemetría DIRECTO (await), no vía
    // trackIntegration: deliver() nunca corre en un request plano — o está dentro
    // de un after() (settle) o del cron (tick). En ambos, el after()-first de
    // trackIntegration es poco fiable (cae al void que dejaba el ping sin escribir
    // → el panel quedaba "Nunca recibido" pese a entregarse). Awaitear acá mantiene
    // viva la invocación hasta que el INSERT termina.
    await recordIntegration("webhooks", { providerId });
  } catch {
    /* best-effort: un webhook fallido no rompe el flujo principal */
  }
}

export async function emitPurchaseCompleted(purchaseId: string): Promise<void> {
  const p = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { game: true, user: true },
  });
  if (!p) return;
  await deliver(p.game.providerId, "purchase.completed", {
    purchaseId: p.id,
    gameId: p.gameId,
    slug: p.game.slug,
    npub: p.user.npub,
    amountSats: p.amountSats,
    paidAt: p.paidAt,
  });
}

export async function emitPayoutSent(purchaseId: string): Promise<void> {
  const p = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { game: true },
  });
  if (!p || p.payoutStatus !== "paid") return;
  const shareSats = Math.floor((p.amountSats * p.game.revenueShare) / 100);
  await deliver(p.game.providerId, "payout.sent", {
    purchaseId: p.id,
    gameId: p.gameId,
    shareSats,
    payoutHash: p.payoutHash,
  });
}

/**
 * Metadata de correlación que se adjunta a TODO webhook de apuesta, para que el
 * juego mapee la apuesta a su sala multijugador sin mantener su propia tabla.
 */
function correlation(bet: Bet): { roomId: string | null; metadata: unknown } {
  let metadata: unknown = null;
  if (bet.metadataJson) {
    try {
      metadata = JSON.parse(bet.metadataJson);
    } catch {
      /* metadata corrupta → null */
    }
  }
  return { roomId: bet.roomId ?? null, metadata };
}

const sats = (msat: bigint) => Number(msatToSats(msat));

export async function emitBetSettled(betId: string): Promise<void> {
  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { participants: true },
  });
  if (!bet) return;
  const won = bet.participants.filter((p) => p.result === "won" || p.result === "tie");
  const payouts = won
    .filter((p) => p.payoutMsat != null)
    .map((p) => ({ npub: p.npub, amountSats: sats(p.payoutMsat as bigint) }));
  const fee = await prisma.ledgerEntry.findFirst({
    where: { betId: bet.id, kind: "fee" },
  });
  await deliver(bet.providerId, "bet.settled", {
    betId: bet.id,
    gameId: bet.gameId,
    winners: won.map((p) => p.npub),
    payouts,
    feeSats: fee ? sats(fee.amountMsat) : 0,
    ...correlation(bet),
  });
}

/** Un participante depositó su stake; informa el pozo acumulado y el progreso. */
export async function emitDepositReceived(betId: string, npub: string): Promise<void> {
  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { participants: true },
  });
  if (!bet) return;
  const paid = bet.participants.filter((p) => p.depositStatus === "paid");
  await deliver(bet.providerId, "deposit.received", {
    betId: bet.id,
    gameId: bet.gameId,
    npub,
    amountSats: sats(bet.stakeMsat),
    potSats: sats(bet.stakeMsat) * paid.length,
    potTargetSats: sats(bet.stakeMsat) * bet.participants.length,
    depositsReceived: paid.length,
    depositsTotal: bet.participants.length,
    ...correlation(bet),
  });
}

/** El pozo se completó (todos depositaron). */
export async function emitBetFunded(betId: string): Promise<void> {
  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { participants: true },
  });
  if (!bet) return;
  await deliver(bet.providerId, "bet.funded", {
    betId: bet.id,
    gameId: bet.gameId,
    potSats: sats(bet.stakeMsat) * bet.participants.length,
    participants: bet.participants.map((p) => p.npub),
    ...correlation(bet),
  });
}

/** El proveedor canceló la apuesta antes de resolverse. */
export async function emitBetCancelled(betId: string): Promise<void> {
  const bet = await prisma.bet.findUnique({ where: { id: betId } });
  if (!bet) return;
  await deliver(bet.providerId, "bet.cancelled", {
    betId: bet.id,
    gameId: bet.gameId,
    reason: "provider_cancel",
    ...correlation(bet),
  });
}

/** Venció el plazo de depósito sin completarse el pozo. */
export async function emitBetExpired(betId: string): Promise<void> {
  const bet = await prisma.bet.findUnique({ where: { id: betId } });
  if (!bet) return;
  await deliver(bet.providerId, "bet.expired", {
    betId: bet.id,
    gameId: bet.gameId,
    reason: "deposit_timeout",
    ...correlation(bet),
  });
}

/**
 * Se reembolsaron depósitos. Acompaña a cancelled/expired/void/resolve_timeout
 * (es el evento "de plata"; el otro es el de ciclo de vida). `refunds` lista a
 * cada participante reembolsado con su monto.
 */
export async function emitBetRefunded(
  betId: string,
  reason: "cancelled" | "expired" | "void" | "resolve_timeout",
): Promise<void> {
  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { participants: true },
  });
  if (!bet) return;
  const refunds = bet.participants
    .filter((p) => p.depositStatus === "refunded")
    .map((p) => ({ npub: p.npub, amountSats: sats(bet.stakeMsat) }));
  await deliver(bet.providerId, "bet.refunded", {
    betId: bet.id,
    gameId: bet.gameId,
    reason,
    refunds,
    ...correlation(bet),
  });
}
