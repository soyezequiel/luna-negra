import { SimplePool, verifyEvent, type Event } from "nostr-tools";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { NGP_BET_RESULT_KIND, NGP_BET_TAG, NGP_BETS_ENABLED } from "./ngp-bet-state";
import { settleZapBetWithResult, type ZapBetWithRelations } from "./escrow-v2-settle";
import { payParticipantV2 } from "./escrow-v2-payout";
import { emitBetCancelledV2, emitBetRefundedV2 } from "./webhooks";
import { publishNgpBetState } from "./ngp-bet-state";
import { isTerminal } from "./bet-state";
import { notifyOperationalError } from "./discord";

/**
 * Resultados de apuestas por Nostr (NGP apuestas, Fase 1). El oráculo del
 * proveedor publica un kind:1341 firmado con su clave (`e` = ancla del contrato,
 * `p` = ganadores, `status` = win|draw|void) y acá lo levantamos de relays, lo
 * validamos y liquidamos con el MISMO núcleo que `POST /api/v2/bets/{id}/result`
 * (settleZapBetWithResult). La autenticación ES la firma: sin API key.
 *
 * Mismo patrón in-process que score-sync (scheduler en instrumentation.node.ts,
 * gateado por BETS_V2_ENABLED + NGP_BETS_ENABLED). Idempotente: el settle tiene
 * claim ready→settling y estados terminales; "el primero válido gana", los 1341
 * siguientes del mismo contrato mueren en ALREADY_RESOLVED.
 *
 * Ver docs/nostr-games-protocol-apuestas.md (§5).
 */

// Cadencia del sync. 0 = desactivado.
export const NGP_BET_RESULT_SYNC_INTERVAL_MS = Number(
  process.env.NGP_BET_RESULT_SYNC_INTERVAL_MS ?? 30_000,
); // 30 s: el premio es lo que el jugador espera en vivo

// Primera corrida tras el boot: mirar unas horas hacia atrás para agarrar
// resultados publicados mientras el server estaba caído. Las apuestas más viejas
// ya son terminales (la ventana de resolución es de minutos) y se descartan solas.
const FIRST_RUN_LOOKBACK_S = 6 * 3600;
// Solape entre corridas: no perder eventos que un relay sirvió tarde.
const OVERLAP_S = 120;

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

// Cursor + dedup en memoria (una sola instancia en self-host). Un evento entra a
// `processed` solo cuando su destino es definitivo (liquidado, inválido o apuesta
// terminal); si la apuesta todavía no está `ready`, queda afuera para reintentar.
let lastCheckedAt = 0;
const processed = new Set<string>();
const PROCESSED_MAX = 2_000;

function markProcessed(id: string): void {
  processed.add(id);
  if (processed.size > PROCESSED_MAX) {
    // Set itera en orden de inserción: podamos los más viejos.
    for (const old of processed) {
      processed.delete(old);
      if (processed.size <= PROCESSED_MAX / 2) break;
    }
  }
}

export async function syncNgpBetResults(): Promise<void> {
  if (!NGP_BETS_ENABLED) return;

  const startedAt = Math.floor(Date.now() / 1000);
  const since =
    lastCheckedAt > 0 ? lastCheckedAt - OVERLAP_S : startedAt - FIRST_RUN_LOOKBACK_S;

  let events: Event[];
  try {
    events = await pool().querySync(
      RELAYS,
      { kinds: [NGP_BET_RESULT_KIND], "#t": [NGP_BET_TAG], since },
      { maxWait: 5000 },
    );
  } catch {
    return; // relays caídos: reintentamos en el próximo tick (cursor intacto)
  }

  // Orden cronológico: si llegan dos 1341 contradictorios, gana el primero.
  events.sort((a, b) => a.created_at - b.created_at);
  for (const ev of events) {
    try {
      await handleNgpResultEvent(ev);
    } catch (err) {
      await notifyOperationalError({
        source: "ngp-bet-result-sync",
        error: err,
        fingerprint: `ngp-bet-result-sync:${ev.id}`,
        cooldownMs: 30 * 60_000,
        context: { eventId: ev.id, pubkey: ev.pubkey },
      });
    }
  }
  lastCheckedAt = startedAt;
}

/**
 * ¿Este 1341 autoriza un VOID DEL RETADOR (cancel pre-fondeo)? Puro para testear
 * la autorización sin relays ni DB. NO valida la firma: asume que `signerPubkey`
 * ya viene de un evento verificado (el caller corre `verifyEvent` antes). Reglas:
 * `status=void`, la apuesta sigue esperando depósitos (`pending_deposits`) y el
 * firmante es EXACTAMENTE el autor del contrato (`contractPubkey`). Una vez
 * fondeada (`ready`) el retador ya no puede anular: solo el oráculo.
 */
export function isChallengerVoid(args: {
  status: string;
  betStatus: string;
  contractPubkey: string | null;
  signerPubkey: string;
}): boolean {
  return (
    args.status === "void" &&
    args.betStatus === "pending_deposits" &&
    !!args.contractPubkey &&
    args.signerPubkey === args.contractPubkey
  );
}

/**
 * Valida y liquida UN evento de resultado. Separado del sync para poder
 * testearlo sin relays. Reglas de la spec (§5): firma válida, `e` == ancla de una
 * apuesta conocida, y luego dos caminos:
 *  - VOID DEL RETADOR (pre-fondeo): `status=void` firmado por el AUTOR del contrato
 *    (`bet.contractPubkey`) mientras la apuesta esté `pending_deposits` → cancel +
 *    reembolso (equivale al cancel v2).
 *  - LIQUIDACIÓN (fondeada): firmante == oráculo del proveedor, ganadores ⊆
 *    participantes; `draw`/`void` ⇒ reembolso (winners vacío, mismo camino que v2).
 */
export async function handleNgpResultEvent(ev: Event): Promise<void> {
  if (ev.kind !== NGP_BET_RESULT_KIND) return;
  if (processed.has(ev.id)) return;
  if (!verifyEvent(ev)) {
    markProcessed(ev.id);
    return;
  }

  const anchorId = ev.tags.find((t) => t[0] === "e")?.[1];
  if (!anchorId) {
    markProcessed(ev.id);
    return;
  }
  const bet = await prisma.zapBet.findUnique({
    where: { anchorEventId: anchorId },
    include: { provider: { include: { owner: true } }, participants: true },
  });
  if (!bet) {
    // Ancla ajena (otro escrow que usa la spec) o contrato que no es nuestro.
    markProcessed(ev.id);
    return;
  }
  if (isTerminal(bet.status)) {
    markProcessed(ev.id);
    return;
  }

  const status = ev.tags.find((t) => t[0] === "status")?.[1] ?? "win";

  // VOID DEL RETADOR (cancel pre-fondeo, spec §5 y Fase 3). El AUTOR del contrato
  // (no el oráculo) puede anular su apuesta con un 1341 `status=void` mientras nadie
  // haya completado el fondeo (`pending_deposits` = público `accepted`). Equivale al
  // cancel de v2: reembolsa lo que se haya depositado y termina en `cancelled_admin`
  // (proyecta a NGP `void`). Una vez `ready` (todos fondearon) ya no puede anular:
  // de ahí en más manda el oráculo, así que este branch NO aplica y cae al de abajo.
  if (
    isChallengerVoid({
      status,
      betStatus: bet.status,
      contractPubkey: bet.contractPubkey,
      signerPubkey: ev.pubkey,
    })
  ) {
    await cancelNgpBetPreFunding(bet, ev);
    markProcessed(ev.id);
    return;
  }

  if (!bet.provider.oraclePubkey || ev.pubkey !== bet.provider.oraclePubkey) {
    console.warn(
      `[ngp-bet-result] 1341 ${ev.id} firmado por ${ev.pubkey}, no por el oráculo de ${bet.id}; ignorado`,
    );
    markProcessed(ev.id);
    return;
  }

  let winnerNpubs: string[] = [];
  if (status === "win") {
    const winnerPks = ev.tags.filter((t) => t[0] === "p").map((t) => t[1]);
    if (winnerPks.length === 0) {
      markProcessed(ev.id); // "win" sin ganadores no es interpretable
      return;
    }
    const npubByPubkey = new Map(bet.participants.map((p) => [p.pubkey, p.npub]));
    const npubs = winnerPks.map((pk) => npubByPubkey.get(pk));
    if (npubs.some((n) => !n)) {
      markProcessed(ev.id); // ganador fuera del contrato: evento inválido
      return;
    }
    winnerNpubs = npubs as string[];
  } else if (status !== "draw" && status !== "void") {
    markProcessed(ev.id);
    return;
  }

  // Todavía no está fondeada: el settle daría NOT_READY. No marcamos el evento:
  // se reintenta en la próxima pasada (hasta que fondee o el tick la expire).
  if (bet.status !== "ready") return;

  const res = await settleZapBetWithResult({ bet, winnerNpubs, resultEvent: ev });
  if (res.ok) {
    markProcessed(ev.id);
    console.log(
      `[ngp-bet-result] apuesta ${bet.id} liquidada por evento ${ev.id} (${status})`,
    );
    return;
  }
  // NOT_READY (carrera con otro settle) y SETTLE_FAILED (pago falló, quedó ready)
  // se reintentan en la próxima pasada; el resto es definitivo para este evento.
  if (res.code !== "NOT_READY" && res.code !== "SETTLE_FAILED") {
    markProcessed(ev.id);
  }
}

/**
 * Anula una apuesta NGP pre-fondeo por decisión del retador (1341 `status=void`).
 * Mismo núcleo que el cancel v2 (`/api/v2/bets/{id}/cancel`): claim optimista
 * `pending_deposits → refunding`, reembolso por zap de los depósitos ya
 * confirmados (a lo sumo el del propio retador) y estado terminal
 * `cancelled_admin` (proyecta a NGP `void`, reason `cancelled`). El claim
 * serializa contra el tick y contra otro 1341: si otro proceso ya movió la
 * apuesta, `count !== 1` y salimos sin tocar nada.
 */
async function cancelNgpBetPreFunding(
  bet: ZapBetWithRelations,
  ev: Event,
): Promise<void> {
  const claimed = await prisma.zapBet.updateMany({
    where: { id: bet.id, status: "pending_deposits" },
    data: { status: "refunding" },
  });
  if (claimed.count !== 1) return; // carrera: el tick u otro 1341 ganó

  for (const p of bet.participants.filter((x) => x.depositStatus === "paid")) {
    await payParticipantV2({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
  }
  await prisma.zapBet.update({
    where: { id: bet.id },
    data: { status: "cancelled_admin", resultEventId: ev.id },
  });

  await emitBetCancelledV2(bet.id);
  await emitBetRefundedV2(bet.id, "cancelled");
  await publishNgpBetState(bet.id);
  console.log(`[ngp-bet-result] apuesta ${bet.id} anulada por el retador (evento ${ev.id})`);
}
