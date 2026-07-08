import { prisma } from "./prisma";
import { publishStoreEvent } from "./nostr-server";
import { msatToSats } from "./money";
import { getEconomySettings } from "./economy-settings";
import {
  BET_MIN_SATS,
  BET_MAX_SATS,
  BET_FEE_MIN_SATS,
  BET_MAX_ANONYMOUS_SEATS,
  DEPOSIT_WINDOW_MS,
  RESOLVE_WINDOW_MS,
  WITHDRAW_WINDOW_MS,
} from "./escrow-v2-config";

/**
 * Estado del ESCROW TRANSPARENTE (NGP apuestas, Fase 0 — sombra observacional).
 * Luna Negra publica cada transición de una apuesta v2 como evento addressable
 * kind:31340 (`d` = id del contrato), firmado con la clave de la tienda. La
 * fuente de verdad sigue siendo la DB/REST: esto NO decide nada, solo hace el
 * estado auditable desde cualquier cliente Nostr. Con `d`="terms" publica las
 * condiciones del escrow (comisiones, límites, ventanas).
 *
 * Ver docs/nostr-games-protocol-apuestas.md (spec, §2.1 y §4).
 */

// Kinds congelados de la spec (viven en ngp-kinds.ts, módulo puro; acá se
// re-exportan para no tocar a los importadores existentes). Los TEMPLATES de los
// eventos (el formato del protocolo) viven en ngp-events.ts, también puro: este
// módulo es solo el SERVICIO — leer la DB, mapear y publicar.
export {
  NGP_BET_CONTRACT_KIND,
  NGP_BET_RESULT_KIND,
  NGP_BET_STATE_KIND,
  NGP_BET_TAG,
} from "./ngp-kinds";
import {
  buildNgpBetStateTemplate,
  buildNgpTermsTemplate,
  type NgpPayoutEntry,
} from "./ngp-events";

// Flag maestro de la capa NGP de apuestas (independiente de BETS_V2_ENABLED,
// que apaga el motor v2 entero). "false" explícito lo desactiva.
export const NGP_BETS_ENABLED = process.env.NGP_BETS_ENABLED !== "false";

// Estado NGP público (spec §4) desde el estado interno de ZapBet. Los estados
// transicionales (refunding/settling) no se publican: el terminal llega enseguida
// y publicar el intermedio solo mete ruido en relays.
function ngpStatusFor(internal: string): { status: string; reason?: string } | null {
  switch (internal) {
    case "created":
    case "pending_deposits":
      return { status: "accepted" };
    case "ready":
      return { status: "funded" };
    case "settled":
      return { status: "resolved" };
    case "voided":
      return { status: "void", reason: "oracle_void" };
    case "refunded_timeout":
      return { status: "void", reason: "resolve_timeout" };
    case "cancelled_admin":
      return { status: "void", reason: "cancelled" };
    case "cancelled_incomplete":
      return { status: "expired", reason: "deposit_timeout" };
    default:
      return null;
  }
}

// Memos a nivel PROCESO (globalThis): Turbopack duplica este módulo en varios
// chunks del server (rutas vs instrumentation) — patrón [[turbopack-estado-duplicado-globalthis]].
declare global {
  // Content del evento `terms` ya publicado (republicar solo si cambió).
  // eslint-disable-next-line no-var
  var lunaNgpTermsContent: string | undefined;
  // Último created_at publicado por ancla: los relays reemplazan un addressable
  // por created_at (a igual timestamp puede ganar el viejo), así que dos
  // transiciones en el mismo segundo necesitan timestamps estrictamente crecientes.
  // eslint-disable-next-line no-var
  var lunaNgpStateClock: Map<string, number> | undefined;
}

function nextStateTimestamp(anchorId: string): number {
  const clock = (globalThis.lunaNgpStateClock ??= new Map<string, number>());
  const ts = Math.max(Math.floor(Date.now() / 1000), (clock.get(anchorId) ?? 0) + 1);
  clock.set(anchorId, ts);
  return ts;
}

const sats = (msat: bigint) => Number(msatToSats(msat));

/**
 * ¿La apuesta pidió liquidación "unlisted"? (create_bet.visibility de NGE, spec
 * §7). Omite la sombra 31340 y la nota social de ESA apuesta; el contrato-ancla
 * y los recibos existen igual (son el riel del escrow). Antes TODA apuesta NGE
 * quedaba excluida de la sombra "por privacidad" — incoherente: el ancla y los
 * payouts ya eran públicos. Ahora la transparencia es el default y la discreción
 * es un opt-in explícito por apuesta.
 */
export function isUnlistedBet(metadataJson: string | null): boolean {
  if (!metadataJson) return false;
  try {
    const meta = JSON.parse(metadataJson) as {
      nge?: { visibility?: string };
      visibility?: string;
    };
    return meta?.nge?.visibility === "unlisted" || meta?.visibility === "unlisted";
  } catch {
    return false;
  }
}

/**
 * Publica (o re-publica) el estado NGP de una apuesta v2. Best-effort: nunca
 * lanza y nunca bloquea al caller — los call sites la disparan fire-and-forget
 * en cada transición (crear, depósito, funded, settle, void, expire).
 */
export async function publishNgpBetState(betId: string): Promise<void> {
  if (!NGP_BETS_ENABLED) return;
  try {
    const bet = await prisma.zapBet.findUnique({
      where: { id: betId },
      include: {
        participants: { orderBy: { createdAt: "asc" } },
        game: { select: { nostrCoord: true } },
      },
    });
    if (!bet?.anchorEventId || bet.anchorEventId.startsWith("dev-anchor-")) return;
    // Solo se omite la sombra si la apuesta pidió "unlisted" explícito.
    if (isUnlistedBet(bet.metadataJson)) return;
    const mapped = ngpStatusFor(bet.status);
    if (!mapped) return;

    const deposits = bet.participants
      .filter((p) => p.depositStatus === "paid")
      .map((p) => ({
        p: p.pubkey,
        ...(p.depositReceiptId ? { receipt: p.depositReceiptId } : {}),
      }));
    const payouts: NgpPayoutEntry[] = bet.participants
      .filter((p) => p.payoutMsat != null && p.payoutStatus !== "none")
      .map((p) => ({
        p: p.pubkey,
        sats: sats(p.payoutMsat!),
        status: p.payoutStatus,
        ...(p.payoutKind ? { kind: p.payoutKind } : {}),
        ...(p.payoutZapRequestId ? { zapRequest: p.payoutZapRequestId } : {}),
        ...(p.payoutReceiptId ? { receipt: p.payoutReceiptId } : {}),
      }));

    const id = await publishStoreEvent(
      buildNgpBetStateTemplate({
        anchorEventId: bet.anchorEventId,
        gameCoord: bet.game.nostrCoord,
        status: mapped.status,
        reason: mapped.reason,
        betId: bet.id,
        stakeSats: sats(bet.stakeMsat),
        participants: bet.participants.map((p) => p.pubkey),
        feePct: bet.feePct,
        devFeePct: bet.devFeePct,
        depositDeadline: bet.depositDeadline
          ? Math.floor(bet.depositDeadline.getTime() / 1000)
          : null,
        resolveDeadline: bet.resolveDeadline
          ? Math.floor(bet.resolveDeadline.getTime() / 1000)
          : null,
        deposits,
        payouts,
        resultEventId: bet.resultEventId,
        settleNoteId: bet.settleNoteId,
        createdAt: nextStateTimestamp(bet.anchorEventId),
      }),
    );
    if (!id) {
      console.warn(
        `[ngp-bet-state] ningún relay aceptó el estado ${mapped.status} de ${betId}`,
      );
    }
  } catch (err) {
    console.warn(`[ngp-bet-state] no se pudo publicar el estado de ${betId}:`, err);
  }
}

/**
 * Publica las condiciones del escrow (kind:31340, `d`="terms"): comisiones por
 * defecto, límites de stake y ventanas. Memoizada por contenido: republicar solo
 * si el admin cambió la economía o cambiaron los env. Best-effort, nunca lanza.
 */
export async function ensureNgpEscrowTerms(): Promise<void> {
  if (!NGP_BETS_ENABLED) return;
  try {
    const economy = await getEconomySettings();
    const template = buildNgpTermsTemplate({
      minStakeSats: BET_MIN_SATS,
      maxStakeSats: BET_MAX_SATS,
      feePct: economy.betFeePct,
      devFeeMaxPct: economy.betDevFeeMaxPct,
      feeMinSats: BET_FEE_MIN_SATS,
      maxSeats: BET_MAX_ANONYMOUS_SEATS,
      depositWindowSec: Math.floor(DEPOSIT_WINDOW_MS / 1000),
      resolveWindowSec: Math.floor(RESOLVE_WINDOW_MS / 1000),
      withdrawWindowSec: Math.floor(WITHDRAW_WINDOW_MS / 1000),
    });
    if (globalThis.lunaNgpTermsContent === template.content) return;

    const id = await publishStoreEvent(template);
    if (id) globalThis.lunaNgpTermsContent = template.content;
  } catch (err) {
    console.warn("[ngp-bet-state] no se pudieron publicar las terms del escrow:", err);
  }
}
