import { SimplePool, nip57, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";

/**
 * Reconciliación de ZAPS (NIP-57). Fuente de verdad del "top de zappers": en vez
 * de creerle al wallet del cliente, levantamos de relays los recibos de zap
 * (kind 9735) firmados por el wallet del dev, los validamos criptográficamente y
 * los guardamos deduplicados en la tabla `Zap`. Captura también zaps hechos al
 * anuncio del juego desde OTROS clientes Nostr (Primal, Amethyst, etc.).
 *
 * El scheduler vive en src/instrumentation.ts (mismo patrón que el tick de
 * escrow). Idempotente: `upsert` por `receiptId`, así re-correr no duplica.
 */

// Cadencia del sync corriendo IN-PROCESS (self-host). 0 = desactivado.
export const ZAP_SYNC_INTERVAL_MS = Number(
  process.env.ZAP_SYNC_INTERVAL_MS ?? 60_000,
); // 60 s

// Solape entre corridas: pedimos desde `lastChecked - OVERLAP` para no perder
// recibos que un relay sirvió tarde. El dedup por receiptId absorbe el solape.
const OVERLAP_SECONDS = 120;

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

// Cursor en memoria (una sola instancia en self-host). 0 = primera corrida:
// barre todo el historial (acotado: hay pocos zaps al principio).
let lastCheckedAt = 0;

type GameTarget = { gameId: string; providerId: string; signer: string };

export async function syncZapReceipts(): Promise<void> {
  // Juegos zapeables: publicados, con anuncio (ancla `e`) y con el firmante del
  // LNURL ya cacheado (lo setea zap/prepare la primera vez que alguien zapea).
  const games = await prisma.game.findMany({
    where: {
      status: "published",
      nostrEventId: { not: null },
      zapLnurlPubkey: { not: null },
    },
    select: {
      id: true,
      providerId: true,
      nostrEventId: true,
      zapLnurlPubkey: true,
    },
  });
  if (games.length === 0) return;

  const byEvent = new Map<string, GameTarget>();
  for (const g of games) {
    if (g.nostrEventId && g.zapLnurlPubkey) {
      byEvent.set(g.nostrEventId, {
        gameId: g.id,
        providerId: g.providerId,
        signer: g.zapLnurlPubkey,
      });
    }
  }

  const since = lastCheckedAt > 0 ? lastCheckedAt - OVERLAP_SECONDS : undefined;
  const startedAt = Math.floor(Date.now() / 1000);

  let receipts: Event[];
  try {
    receipts = await pool().querySync(
      RELAYS,
      { kinds: [9735], "#e": [...byEvent.keys()], ...(since ? { since } : {}) },
      { maxWait: 5000 },
    );
  } catch {
    return; // relays caídos: reintentamos en el próximo tick (cursor intacto)
  }

  for (const receipt of receipts) {
    try {
      await recordReceipt(receipt, byEvent);
    } catch {
      /* recibo inválido o ya registrado: seguimos con el resto */
    }
  }
  lastCheckedAt = startedAt;
}

async function recordReceipt(
  receipt: Event,
  byEvent: Map<string, GameTarget>,
): Promise<void> {
  if (receipt.kind !== 9735) return;

  // ¿A qué juego apunta? El `e` del recibo tiene que ser un anuncio conocido.
  let target: GameTarget | undefined;
  let eventId: string | undefined;
  for (const t of receipt.tags) {
    if (t[0] === "e" && t[1] && byEvent.has(t[1])) {
      target = byEvent.get(t[1]);
      eventId = t[1];
      break;
    }
  }
  if (!target || !eventId) return;

  // El recibo TIENE que venir firmado por el wallet LNURL del dev (anti-forja).
  if (receipt.pubkey !== target.signer) return;

  // Zap request (9734) embebido: prueba quién zapeó y cuánto. Validamos firma.
  const desc = receipt.tags.find((t) => t[0] === "description")?.[1];
  if (!desc || nip57.validateZapRequest(desc)) return;

  let zr: { pubkey: string; content?: string; tags: string[][] };
  try {
    zr = JSON.parse(desc);
  } catch {
    return;
  }
  // El zap request tiene que apuntar al mismo anuncio (coherencia recibo↔request).
  if (zr.tags.find((t) => t[0] === "e")?.[1] !== eventId) return;

  // Monto: del bolt11 del recibo; si no, del tag `amount` (msat) del request.
  const bolt11 = receipt.tags.find((t) => t[0] === "bolt11")?.[1];
  let amountSats = bolt11
    ? Math.round(nip57.getSatoshisAmountFromBolt11(bolt11))
    : 0;
  if (!amountSats) {
    const amtMsat = Number(zr.tags.find((t) => t[0] === "amount")?.[1]);
    if (Number.isFinite(amtMsat) && amtMsat > 0) {
      amountSats = Math.round(amtMsat / 1000);
    }
  }
  if (amountSats < 1) return;

  const comment =
    typeof zr.content === "string" && zr.content.trim()
      ? zr.content.trim().slice(0, 280)
      : null;
  const zappedAt = new Date(
    (receipt.created_at || Math.floor(Date.now() / 1000)) * 1000,
  );

  await prisma.zap.upsert({
    where: { receiptId: receipt.id },
    create: {
      receiptId: receipt.id,
      gameId: target.gameId,
      providerId: target.providerId,
      zapperPubkey: zr.pubkey,
      amountSats,
      comment,
      zappedAt,
    },
    update: {}, // idempotente: si ya existe, no lo tocamos
  });
}
