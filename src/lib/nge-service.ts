import { finalizeEvent, verifyEvent, type Event } from "nostr-tools/pure";
import { SimplePool, nip19 } from "nostr-tools";
import {
  NGE_KIND,
  NGE_VERSION,
  responseTemplate,
  decryptPayload,
  type NgeRequestPayload,
  type NgeResponsePayload,
} from "../../sdk/nge";
import { prisma } from "@/lib/prisma";
import { RELAYS } from "@/lib/constants";
import {
  getStorePubkey,
  getStoreSecretKey,
  publishContract,
  ensureStoreZapProfile,
} from "@/lib/nostr-server";
import { getEconomySettings, resolveBetFees } from "@/lib/economy-settings";
import {
  BET_MIN_SATS,
  BET_MAX_SATS,
  BET_MAX_ANONYMOUS_SEATS,
  BET_FEE_MIN_SATS,
  DEPOSIT_WINDOW_MS,
} from "@/lib/escrow-v2-config";
import { computeContractHash } from "@/lib/escrow";
import { buildContractTextV2, buildContractTagsV2 } from "@/lib/escrow-v2";
import { createGuestUsers } from "@/lib/guest-users";
import {
  ensurePlainDepositInvoiceV2,
  checkAndSettleDepositV2,
} from "@/lib/zap-bet";
import { settleZapBetWithResult, type ZapBetWithRelations } from "@/lib/escrow-v2-settle";
import { payParticipantV2 } from "@/lib/escrow-v2-payout";
import { ensureOracleKey, getOracleSecret } from "@/lib/oracle-keys";
import { signResultEventV2 } from "@/lib/nostr-server";
import { isTerminal } from "@/lib/bet-state";
import { emitBetCancelledV2, emitBetRefundedV2 } from "@/lib/webhooks";
import { beginIdempotent } from "@/lib/idempotency";
import { msatToSats } from "@/lib/money";
import { trackIntegration } from "@/lib/integration-telemetry";
import { notifyOperationalError } from "@/lib/discord";
import type { ZapBet, ZapBetParticipant } from "@prisma/client";

// Servicio NGE v2 (Nostr Game Escrow): el lado ESCROW del RPC estilo NWC.
// Escucha requests kind:24940 cifrados (NIP-44) dirigidos a la pubkey de la
// tienda, autentica al cliente `C` contra las credenciales emitidas
// (NgeCredential.servicePubkey), despacha al motor de apuestas v2 y responde
// con un kind:24941 firmado por la tienda. Spec: docs/nge/nge-v2-spec.md.
//
// Decisiones de implementación:
//  - Todos los asientos NGE son identidades invitadas del motor (guest users):
//    así el depósito SIEMPRE sale como bolt11 directo (Luna firma internamente
//    el 9734 custodial). `payoutAddress` se vuelca al lud16 del invitado y la
//    cascada de payouts existente paga ahí; sin dirección → retiro por QR.
//  - El mapeo seatId↔asiento y el `clientRef` viajan en ZapBet.metadataJson bajo
//    la clave `nge`; esa marca además EXCLUYE a la apuesta de la sombra pública
//    31340 (privacidad, spec §2 — ver isNgeV2Bet en ngp-bet-state.ts).
//  - Dedup por id de request (§6.1): la response firmada se cachea en memoria y
//    un reenvío del MISMO evento la re-publica sin re-ejecutar nada. Las
//    mutaciones además son idempotentes por clave natural (betId / clientRef),
//    así que un reinicio del proceso tampoco duplica efectos.

const NGE_V2_ENABLED = process.env.NGE_V2_ENABLED !== "false";
/** Ventana de frescura de un request (spec §6): fuera de esto → EXPIRED_REQUEST. */
const FRESH_WINDOW_SEC = 300;
/** TTL del caché de responses (cubre reenvíos del cliente hasta su timeout). */
const RESPONSE_CACHE_TTL_MS = 10 * 60_000;
/** Anti-rebote del lookup on-demand de depósitos en `get_bet` (como el GET REST). */
const ONDEMAND_CHECK_MIN_MS = 1500;
/** Ventana de fondeo aceptada para `deadlineSec` (clamp). */
const MIN_DEPOSIT_WINDOW_MS = 60_000;
const MAX_DEPOSIT_WINDOW_MS = 24 * 60 * 60_000;

// Estado a nivel PROCESO en globalThis: Turbopack duplica módulos server en
// varios chunks; con `let` locales habría un servicio (y un caché) por copia.
declare global {
  // eslint-disable-next-line no-var
  var lunaNgeServiceStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var lunaNgeResponseCache: Map<string, { ev: Event | null; expiresAt: number }> | undefined;
  // eslint-disable-next-line no-var
  var lunaNgeDepositCheckAt: Map<string, number> | undefined;
}
const responseCache = (globalThis.lunaNgeResponseCache ??= new Map());
const depositCheckAt = (globalThis.lunaNgeDepositCheckAt ??= new Map());

const nowSec = () => Math.floor(Date.now() / 1000);
const sats = (msat: bigint) => Number(msatToSats(msat));

type NgeSeatMeta = { seatId: string; npub: string; pubkey?: string };
type NgeMeta = { seats: NgeSeatMeta[]; clientRef?: string };

function parseNgeMeta(metadataJson: string | null): NgeMeta | null {
  if (!metadataJson) return null;
  try {
    const meta = JSON.parse(metadataJson) as { nge?: NgeMeta };
    return meta?.nge && Array.isArray(meta.nge.seats) ? meta.nge : null;
  } catch {
    return null;
  }
}

/** Estado interno del motor → estado público NGE (spec §7). */
function ngeStatus(internal: string): string {
  switch (internal) {
    case "created":
    case "pending_deposits":
      return "pending_deposits";
    case "ready":
      return "funded";
    case "settling":
    case "refunding":
      return "resolving";
    case "settled":
      return "settled";
    case "cancelled_admin":
      return "cancelled";
    case "cancelled_incomplete":
      return "expired";
    case "refunded_timeout":
    case "voided":
      return "refunded";
    default:
      return internal;
  }
}

function ok(method: string, result: Record<string, unknown>): NgeResponsePayload {
  return { result_type: method, result };
}

function fail(method: string, code: string, message: string): NgeResponsePayload {
  return { result_type: method, error: { code, message } };
}

type Credential = NonNullable<Awaited<ReturnType<typeof findCredential>>>;

function findCredential(servicePubkey: string) {
  return prisma.ngeCredential.findUnique({
    where: { servicePubkey },
    include: { game: { include: { provider: true } } },
  });
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// ── Métodos ──────────────────────────────────────────────────────────────────

async function doGetInfo(cred: Credential): Promise<NgeResponsePayload> {
  const economy = await getEconomySettings();
  const { feePct, devFeePct } = resolveBetFees({
    game: { betFeePct: cred.game.betFeePct, betDevFeePct: cred.game.betDevFeePct },
    provider: { betDevFeePct: cred.game.provider.betDevFeePct },
    economy,
  });
  return ok("get_info", {
    methods: ["get_info", "create_bet", "get_bet", "report_result", "cancel_bet"],
    version: NGE_VERSION,
    currency: "sat",
    minStakeSats: BET_MIN_SATS,
    maxStakeSats: BET_MAX_SATS,
    feePct,
    devFeePct,
  });
}

type SeatParam = { seatId?: unknown; pubkey?: unknown; payoutAddress?: unknown };

async function doCreateBet(
  cred: Credential,
  params: Record<string, unknown>,
): Promise<NgeResponsePayload> {
  const method = "create_bet";

  // Validación de params (el SDK ya valida, pero el escrow no confía en nadie).
  const rawSeats = params.seats;
  if (!Array.isArray(rawSeats) || rawSeats.length < 2) {
    return fail(method, "BAD_REQUEST", "se necesitan al menos 2 asientos");
  }
  if (rawSeats.length > BET_MAX_ANONYMOUS_SEATS) {
    return fail(method, "BAD_REQUEST", `máximo ${BET_MAX_ANONYMOUS_SEATS} asientos`);
  }
  const seatIds = new Set<string>();
  const seats: { seatId: string; pubkey?: string; payoutAddress?: string }[] = [];
  for (const raw of rawSeats as SeatParam[]) {
    const seatId = typeof raw?.seatId === "string" ? raw.seatId.trim() : "";
    if (!seatId || seatId.length > 128) {
      return fail(method, "BAD_REQUEST", "cada asiento necesita un seatId (≤128 chars)");
    }
    if (seatIds.has(seatId)) return fail(method, "BAD_REQUEST", `seatId duplicado: ${seatId}`);
    seatIds.add(seatId);
    const pubkey =
      typeof raw.pubkey === "string" && /^[0-9a-f]{64}$/.test(raw.pubkey.trim().toLowerCase())
        ? raw.pubkey.trim().toLowerCase()
        : undefined;
    const payoutAddress =
      typeof raw.payoutAddress === "string" && /^\S+@\S+\.\S+$/.test(raw.payoutAddress.trim())
        ? raw.payoutAddress.trim()
        : undefined;
    seats.push({ seatId, pubkey, payoutAddress });
  }

  const stakeSats = params.stakeSats;
  if (typeof stakeSats !== "number" || !Number.isInteger(stakeSats) || stakeSats <= 0) {
    return fail(method, "BAD_REQUEST", "stakeSats debe ser un entero positivo");
  }
  if (stakeSats < BET_MIN_SATS || stakeSats > BET_MAX_SATS) {
    return fail(
      method,
      "STAKE_OUT_OF_RANGE",
      `stake ${stakeSats} fuera de [${BET_MIN_SATS}, ${BET_MAX_SATS}]`,
    );
  }

  const condition = typeof params.condition === "string" ? params.condition.slice(0, 500) : "";
  let windowMs = DEPOSIT_WINDOW_MS;
  if (typeof params.deadlineSec === "number" && Number.isFinite(params.deadlineSec)) {
    windowMs = Math.min(
      Math.max(params.deadlineSec * 1000 - Date.now(), MIN_DEPOSIT_WINDOW_MS),
      MAX_DEPOSIT_WINDOW_MS,
    );
  }
  const clientRef =
    typeof params.clientRef === "string" && params.clientRef.trim()
      ? params.clientRef.trim().slice(0, 128)
      : null;

  // Idempotencia por clave natural (§6.1): mismo clientRef → mismo betId, aun si
  // el reintento llega en un evento nuevo (id distinto) o tras un reinicio.
  let idem: Awaited<ReturnType<typeof beginIdempotent>> | null = null;
  if (clientRef) {
    const r = await beginIdempotent(`nge:${cred.gameId}`, clientRef);
    if (r.kind === "replay") return ok(method, r.body as Record<string, unknown>);
    if (r.kind === "in_progress") {
      return fail(method, "IN_PROGRESS", "otra create_bet con este clientRef está en curso; reintentá");
    }
    idem = r;
  }

  try {
    // Guard duro (como el POST REST): sin perfil zap de la tienda no hay recibos
    // de depósito válidos.
    if (!(await ensureStoreZapProfile(baseUrl()))) {
      return fail(method, "INTERNAL", "el escrow no pudo publicar su Lightning Address");
    }

    // Identidad del participante por asiento. Con pubkey Nostr (jugador identificado)
    // usamos SU CUENTA REAL (upsert por pubkey): así la apuesta le pertenece —aparece
    // en su perfil / `/bets`— y el premio va a su lud16. Sin pubkey (asiento anónimo)
    // cae a un invitado efímero (cobra por QR si gana sin lud16). El depósito es un
    // bolt11 plano en ambos casos, así que no hace falta clave custodial ni invitado
    // para los jugadores identificados.
    const identities = await Promise.all(
      seats.map(async (s): Promise<{ userId: string; npub: string; pubkey: string }> => {
        if (s.pubkey) {
          const npub = nip19.npubEncode(s.pubkey);
          const user = await prisma.user.upsert({
            where: { pubkey: s.pubkey },
            update: {},
            create: {
              pubkey: s.pubkey,
              npub,
              ...(s.payoutAddress ? { lud16: s.payoutAddress } : {}),
            },
            select: { id: true },
          });
          return { userId: user.id, npub, pubkey: s.pubkey };
        }
        const [guest] = await createGuestUsers(1);
        if (s.payoutAddress) {
          await prisma.user.update({ where: { id: guest.userId }, data: { lud16: s.payoutAddress } });
        }
        return { userId: guest.userId, npub: guest.npub, pubkey: guest.pubkey };
      }),
    );

    const economy = await getEconomySettings();
    const { feePct, devFeePct } = resolveBetFees({
      game: { betFeePct: cred.game.betFeePct, betDevFeePct: cred.game.betDevFeePct },
      provider: { betDevFeePct: cred.game.provider.betDevFeePct },
      economy,
    });

    const stakeMsat = BigInt(stakeSats) * 1000n;
    const depositDeadline = new Date(Date.now() + windowMs);
    const seatsMeta: NgeSeatMeta[] = seats.map((s, i) => ({
      seatId: s.seatId,
      npub: identities[i].npub,
      ...(s.pubkey ? { pubkey: s.pubkey } : {}),
    }));

    const bet = await prisma.zapBet.create({
      data: {
        gameId: cred.gameId,
        providerId: cred.game.providerId,
        status: "pending_deposits",
        stakeMsat,
        feePct,
        devFeePct,
        victoryCondition: condition,
        metadataJson: JSON.stringify({
          nge: { seats: seatsMeta, ...(clientRef ? { clientRef } : {}) },
        }),
        depositDeadline,
        participants: {
          create: identities.map((g) => ({ userId: g.userId, npub: g.npub, pubkey: g.pubkey })),
        },
      },
    });

    const npubs = identities.map((g) => g.npub);
    const contractHash = computeContractHash({
      betId: bet.id,
      gameId: cred.gameId,
      stakeMsat,
      feePct,
      devFeePct,
      victoryCondition: condition,
      npubs,
    });

    // Ancla del contrato (kind:1 de la tienda): invariante duro del motor — los
    // 9734/9735 INTERNOS de los depósitos cuelgan de ella. No es parte del wire
    // protocol NGE (que es privado); es el riel actual del escrow.
    const content = buildContractTextV2({
      betId: bet.id,
      gameTitle: cred.game.title,
      npubs,
      stakeSats,
      victoryCondition: condition,
      feePct,
      devFeePct,
      feeMinSats: BET_FEE_MIN_SATS,
      providerName: cred.game.provider.name,
    });
    const storePubkey = getStorePubkey();
    const tags = buildContractTagsV2({
      betId: bet.id,
      contractHash,
      pubkeys: identities.map((g) => g.pubkey),
      zapReceiver: storePubkey
        ? { pubkey: storePubkey, relay: RELAYS[RELAYS.length - 1] }
        : null,
    });
    const anchorEventId = storePubkey
      ? await publishContract(content, tags)
      : `dev-anchor-${bet.id}`;
    if (!anchorEventId) {
      await prisma.zapBet.update({
        where: { id: bet.id },
        data: { status: "cancelled_admin", contractHash },
      });
      return fail(method, "INTERNAL", "ningún relay aceptó el ancla del contrato; la apuesta no se creó");
    }
    await prisma.zapBet.update({
      where: { id: bet.id },
      data: { contractHash, anchorEventId, anchorEventKind: 1 },
    });

    // Handles de depósito: bolt11 PLANO por asiento (invoice directo del nodo de la
    // tienda, sin zap ni clave custodial). Best-effort; los que fallen se re-emiten en
    // get_bet.
    const fresh = await prisma.zapBet.findUnique({
      where: { id: bet.id },
      include: { participants: true },
    });
    const byNpub = new Map(fresh!.participants.map((p) => [p.npub, p]));
    const deposits = await Promise.all(
      seatsMeta.map(async (s) => {
        const part = byNpub.get(s.npub)!;
        let bolt11: string | null = null;
        try {
          const inv = await ensurePlainDepositInvoiceV2(fresh!, part);
          bolt11 = inv?.invoice ?? null;
        } catch (err) {
          console.error(`[nge] invoice de depósito falló para ${s.seatId} en ${bet.id}:`, err);
        }
        return {
          seatId: s.seatId,
          bolt11,
          amountSats: stakeSats,
          expiresAt: Math.floor(depositDeadline.getTime() / 1000),
        };
      }),
    );

    trackIntegration("bets", { providerId: cred.game.providerId, gameId: cred.gameId });

    const result = { betId: bet.id, status: "pending_deposits", deposits };
    if (idem) await idem.commit(200, result);
    return ok(method, result);
  } catch (err) {
    if (idem) await idem.release();
    throw err;
  }
}

/** Carga una apuesta del juego de la credencial (aislamiento por juego). */
async function findBetFor(cred: Credential, betId: unknown) {
  if (typeof betId !== "string" || !betId.trim()) return null;
  const bet = await prisma.zapBet.findUnique({
    where: { id: betId.trim() },
    include: {
      participants: { orderBy: { createdAt: "asc" } },
    },
  });
  // Una apuesta ajena responde NOT_FOUND (no filtramos existencia entre juegos).
  if (!bet || bet.gameId !== cred.gameId) return null;
  return bet;
}

type BetWithParts = NonNullable<Awaited<ReturnType<typeof findBetFor>>>;

function seatPayout(p: ZapBetParticipant): Record<string, unknown> | null {
  if (p.payoutStatus === "none" || p.payoutMsat == null) return null;
  const tier =
    p.payoutKind ??
    (p.payoutStatus === "withdraw_pending" || p.payoutStatus === "claimed"
      ? "withdraw"
      : "lnurl");
  return {
    tier,
    sats: sats(p.payoutMsat),
    status: p.payoutStatus,
    ...(p.payoutReceiptId ? { receiptId: p.payoutReceiptId } : {}),
  };
}

async function doGetBet(
  cred: Credential,
  params: Record<string, unknown>,
): Promise<NgeResponsePayload> {
  const method = "get_bet";
  let bet = await findBetFor(cred, params.betId);
  if (!bet) return fail(method, "NOT_FOUND", "apuesta no encontrada");
  const meta = parseNgeMeta(bet.metadataJson);
  if (!meta) return fail(method, "NOT_FOUND", "la apuesta no es de NGE v2");

  // Detección on-demand (como el GET REST): verificar los depósitos pendientes
  // ya mismo, con anti-rebote, para que el polling detecte pagos en segundos.
  if (bet.status === "pending_deposits") {
    const nowMs = Date.now();
    const due = bet.participants.filter((p) => {
      if (p.depositStatus !== "pending") return false;
      if (nowMs - (depositCheckAt.get(p.id) ?? 0) < ONDEMAND_CHECK_MIN_MS) return false;
      depositCheckAt.set(p.id, nowMs);
      return true;
    });
    const settled = await Promise.all(due.map((p) => checkAndSettleDepositV2(p.id)));
    if (settled.some(Boolean)) bet = (await findBetFor(cred, params.betId))!;
  }

  const byNpub = new Map(bet.participants.map((p) => [p.npub, p]));
  const open =
    bet.status === "pending_deposits" &&
    (bet.depositDeadline == null || bet.depositDeadline > new Date());

  const seats = await Promise.all(
    meta.seats.map(async (s) => {
      const p = byNpub.get(s.npub);
      if (!p) return { seatId: s.seatId, deposited: false };
      const deposited = p.depositStatus === "paid";
      let bolt11: string | null = null;
      if (open && p.depositStatus === "pending") {
        // El polling también entrega handles frescos (spec §7): si el bolt11 no
        // se pudo emitir al crear, acá se reintenta.
        bolt11 = p.depositInvoice;
        if (!bolt11) {
          try {
            const inv = await ensurePlainDepositInvoiceV2(bet!, p);
            bolt11 = inv?.invoice ?? null;
          } catch {
            /* best-effort: el próximo poll reintenta */
          }
        }
      }
      return {
        seatId: s.seatId,
        deposited,
        ...(bolt11 ? { bolt11 } : {}),
        payout: seatPayout(p),
      };
    }),
  );

  const paidCount = bet.participants.filter((p) => p.depositStatus === "paid").length;
  const winners = meta.seats
    .filter((s) => byNpub.get(s.npub)?.result === "won")
    .map((s) => s.seatId);

  return ok(method, {
    betId: bet.id,
    status: ngeStatus(bet.status),
    stakeSats: sats(bet.stakeMsat),
    potSats: sats(bet.stakeMsat) * paidCount,
    deadlineSec: bet.depositDeadline ? Math.floor(bet.depositDeadline.getTime() / 1000) : null,
    seats,
    result: bet.status === "settled" || bet.status === "voided" ? { winners } : null,
  });
}

async function doReportResult(
  cred: Credential,
  params: Record<string, unknown>,
): Promise<NgeResponsePayload> {
  const method = "report_result";
  const bet = await findBetFor(cred, params.betId);
  if (!bet) return fail(method, "NOT_FOUND", "apuesta no encontrada");
  const meta = parseNgeMeta(bet.metadataJson);
  if (!meta) return fail(method, "NOT_FOUND", "la apuesta no es de NGE v2");

  const rawWinners = params.winners;
  if (!Array.isArray(rawWinners) || rawWinners.some((w) => typeof w !== "string")) {
    return fail(method, "BAD_REQUEST", "winners debe ser un array de seatIds (vacío = anular)");
  }
  // winners ⊆ asientos fondeados (spec §7).
  const byNpub = new Map(bet.participants.map((p) => [p.npub, p]));
  const bySeat = new Map(meta.seats.map((s) => [s.seatId, s]));
  const winnerNpubs: string[] = [];
  for (const seatId of rawWinners as string[]) {
    const seat = bySeat.get(seatId);
    const part = seat ? byNpub.get(seat.npub) : undefined;
    if (!part || part.depositStatus !== "paid") {
      return fail(method, "BAD_WINNER", `el asiento ${seatId} no existe o no está fondeado`);
    }
    winnerNpubs.push(part.npub);
  }

  // Finalidad (spec §7): un resultado ya liquidado no se reescribe. Un reintento
  // IDÉNTICO (mismos winners) con un evento nuevo devuelve éxito igual.
  if (isTerminal(bet.status)) {
    const settledWinners = new Set(
      meta.seats.filter((s) => byNpub.get(s.npub)?.result === "won").map((s) => s.seatId),
    );
    const requested = new Set(rawWinners as string[]);
    const same =
      settledWinners.size === requested.size &&
      [...requested].every((w) => settledWinners.has(w));
    if (same) return ok(method, { ok: true, status: ngeStatus(bet.status) });
    return fail(method, "ALREADY_SETTLED", "la apuesta ya se resolvió con otro resultado");
  }
  if (bet.status === "created" || bet.status === "pending_deposits") {
    return fail(method, "NOT_FUNDED", "la apuesta todavía no está fondeada");
  }

  // Oráculo del proveedor. Espejo de las rutas REST (/api/v*/bets/[id]/result):
  //
  //  - BYO / self-signed → Luna NO custodia el secreto y NO puede firmar por él: el
  //    juego debe firmar su propio 1341 y publicarlo/postearlo. Antes esto caía al
  //    INTERNAL "no se pudo acceder a la clave de oráculo" de más abajo, que el juego
  //    presentaba como un «Reintentar cobro» inútil (el estado es determinista, no
  //    transitorio). Devolvemos un código claro y NO reintentable.
  //  - `getOracleSecret` puede LANZAR (no sólo devolver null) si `ORACLE_ENC_KEY`
  //    falta/cambió o el blob AES-GCM no autentica. Sin este try/catch el throw se
  //    escapa al catch del dispatch como "error interno del escrow", ocultando que el
  //    problema es la clave maestra: lo convertimos en `ORACLE_KEY_ERROR` accionable.
  const prov = await prisma.provider.findUnique({
    where: { id: bet.providerId },
    select: { oracleSelfSigned: true, oraclePubkey: true },
  });
  if (
    prov?.oracleSelfSigned ||
    (bet.oraclePubkey != null && bet.oraclePubkey !== prov?.oraclePubkey)
  ) {
    return fail(
      method,
      "SELF_SIGNED_ORACLE",
      "esta apuesta la resuelve un oráculo propio (BYO): el juego debe firmar el kind:1341 y publicarlo o postearlo; Luna no puede firmar por él",
    );
  }

  let sk: Uint8Array | null;
  try {
    sk = await getOracleSecret(bet.providerId);
    if (!sk) {
      await ensureOracleKey(bet.providerId);
      sk = await getOracleSecret(bet.providerId);
    }
  } catch (err) {
    console.error(`[nge] no se pudo acceder a la clave de oráculo de ${bet.providerId}:`, err);
    await notifyOperationalError({
      source: "nge-oracle-key",
      error: err,
      fingerprint: `nge-oracle-key:${bet.providerId}`,
      context: { betId: bet.id, providerId: bet.providerId },
    });
    return fail(
      method,
      "ORACLE_KEY_ERROR",
      "no se pudo acceder a la clave de oráculo del proveedor (revisá ORACLE_ENC_KEY en el servidor)",
    );
  }
  if (!sk) {
    return fail(
      method,
      "ORACLE_NOT_PROVISIONED",
      "el proveedor no tiene clave de oráculo gestionada; contactá soporte para provisionarla",
    );
  }
  const resultEvent = signResultEventV2(sk, bet.id, winnerNpubs, bet.anchorEventId);

  const full = (await prisma.zapBet.findUnique({
    where: { id: bet.id },
    include: { provider: { include: { owner: true } }, participants: true },
  })) as ZapBetWithRelations;
  const r = await settleZapBetWithResult({ bet: full, winnerNpubs, resultEvent });
  if (r.ok) {
    return ok(method, { ok: true, status: r.finalStatus ?? (r.voided ? "refunded" : "settled") });
  }
  if (r.code === "NOT_READY") {
    const current = await prisma.zapBet.findUnique({ where: { id: bet.id }, select: { status: true } });
    if (current?.status === "settling") {
      return fail(method, "IN_PROGRESS", "la liquidación está en curso; consultá get_bet");
    }
    return fail(method, "NOT_FUNDED", "la apuesta no está lista para resolver");
  }
  return fail(method, "INTERNAL", r.message);
}

async function doCancelBet(
  cred: Credential,
  params: Record<string, unknown>,
): Promise<NgeResponsePayload> {
  const method = "cancel_bet";
  const bet = await findBetFor(cred, params.betId);
  if (!bet) return fail(method, "NOT_FOUND", "apuesta no encontrada");

  // Idempotencia amable: cancelar lo ya cancelado/expirado responde éxito.
  if (bet.status === "cancelled_admin") return ok(method, { ok: true, status: "cancelled" });
  if (bet.status === "cancelled_incomplete") return ok(method, { ok: true, status: "expired" });
  if (isTerminal(bet.status)) {
    return fail(method, "ALREADY_SETTLED", "la apuesta ya se resolvió");
  }
  // Spec §8: cancel_bet solo pre-fondeo TOTAL; una vez funded, la única salida es
  // report_result (incl. winners vacío = anulación con reembolso).
  const claimed = await prisma.zapBet.updateMany({
    where: { id: bet.id, status: { in: ["created", "pending_deposits"] } },
    data: { status: "refunding" },
  });
  if (claimed.count !== 1) {
    return fail(method, "NOT_CANCELLABLE", "la apuesta ya está fondeada: reportá winners vacío para anular");
  }

  for (const p of bet.participants.filter((x) => x.depositStatus === "paid")) {
    await payParticipantV2({ bet, participant: p, amountMsat: bet.stakeMsat, kind: "refund" });
  }
  await prisma.zapBet.update({ where: { id: bet.id }, data: { status: "cancelled_admin" } });
  void emitBetCancelledV2(bet.id).catch(() => {});
  void emitBetRefundedV2(bet.id, "cancelled").catch(() => {});
  return ok(method, { ok: true, status: "cancelled" });
}

// ── Despacho y transporte ────────────────────────────────────────────────────

async function dispatch(cred: Credential, payload: NgeRequestPayload): Promise<NgeResponsePayload> {
  const params = (payload.params ?? {}) as Record<string, unknown>;
  switch (payload.method) {
    case "get_info":
      return doGetInfo(cred);
    case "create_bet":
      return doCreateBet(cred, params);
    case "get_bet":
      return doGetBet(cred, params);
    case "report_result":
      return doReportResult(cred, params);
    case "cancel_bet":
      return doCancelBet(cred, params);
    default:
      return fail(String(payload.method ?? "unknown"), "NOT_IMPLEMENTED", "método desconocido");
  }
}

function pruneCache(): void {
  const now = Date.now();
  for (const [id, entry] of responseCache) {
    if (entry.expiresAt < now) responseCache.delete(id);
  }
}

async function publishResponse(pool: SimplePool, ev: Event): Promise<void> {
  const results = await Promise.allSettled(pool.publish(RELAYS, ev));
  if (!results.some((r) => r.status === "fulfilled")) {
    console.warn(`[nge] ningún relay aceptó la response ${ev.id}`);
  }
}

/** Procesa un request 24940 verificado y publica su response 24941. */
async function handleRequest(pool: SimplePool, sk: Uint8Array, ev: Event): Promise<void> {
  // Dedup por id de request (§6.1): reenvío del MISMO evento → re-publicar la
  // response cacheada sin re-ejecutar; si está en curso, no encimar.
  const cached = responseCache.get(ev.id);
  if (cached) {
    if (cached.ev) await publishResponse(pool, cached.ev);
    return;
  }
  responseCache.set(ev.id, { ev: null, expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS });
  pruneCache();

  let payload: NgeResponsePayload;
  let resultType = "unknown";
  try {
    // Frescura (spec §6): created_at dentro de la ventana + tag expiration.
    const age = Math.abs(nowSec() - ev.created_at);
    const expiration = Number(ev.tags.find((t) => t[0] === "expiration")?.[1]);
    if (age > FRESH_WINDOW_SEC || (Number.isFinite(expiration) && expiration < nowSec())) {
      payload = { result_type: resultType, error: { code: "EXPIRED_REQUEST", message: "request fuera de la ventana de frescura" } };
    } else {
      let req: NgeRequestPayload | null = null;
      try {
        const decoded = decryptPayload(ev.content, sk, ev.pubkey);
        if (decoded && typeof decoded === "object" && typeof (decoded as NgeRequestPayload).method === "string") {
          req = decoded as NgeRequestPayload;
          resultType = req.method;
        }
      } catch {
        req = null;
      }
      if (!req) {
        payload = { result_type: resultType, error: { code: "BAD_REQUEST", message: "payload indescifrable o inválido" } };
      } else {
        // Autenticación (spec §6): solo clientes `C` con credencial vigente. La
        // rotación de la credencial invalida a la anterior → UNAUTHORIZED.
        const cred = await findCredential(ev.pubkey);
        if (!cred) {
          payload = fail(resultType, "UNAUTHORIZED", "cliente no autorizado (¿credencial rotada?)");
        } else {
          payload = await dispatch(cred, req);
        }
      }
    }
  } catch (err) {
    console.error(`[nge] error procesando request ${ev.id}:`, err);
    await notifyOperationalError({
      source: "nge-service",
      error: err,
      fingerprint: `nge-service:${ev.pubkey}`,
      context: { requestId: ev.id },
    });
    payload = { result_type: resultType, error: { code: "INTERNAL", message: "error interno del escrow" } };
  }

  const response = finalizeEvent(
    responseTemplate(payload, { clientPubkey: ev.pubkey, requestId: ev.id, secretKey: sk }),
    sk,
  );
  responseCache.set(ev.id, { ev: response, expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS });
  await publishResponse(pool, response);
}

/**
 * Arranca el servicio NGE v2 (in-process, self-host): suscripción persistente a
 * los requests kind:24940 dirigidos a la tienda, con resuscripción ante cierre.
 * Idempotente por proceso. No hace nada sin clave de tienda o con el flag off.
 */
export function startNgeV2Service(): void {
  if (!NGE_V2_ENABLED) return;
  if (globalThis.lunaNgeServiceStarted) return;
  const sk = getStoreSecretKey();
  const storePubkey = getStorePubkey();
  if (!sk || !storePubkey) {
    console.warn("[nge] sin LUNA_NEGRA_NSEC: el servicio NGE v2 no arranca");
    return;
  }
  globalThis.lunaNgeServiceStarted = true;

  const pool = new SimplePool();
  const subscribe = () => {
    pool.subscribeMany(
      RELAYS,
      // Sin `since`: los kinds 20000–29999 son efímeros, el relay no guarda
      // historial — solo llega lo que se publique con la suscripción viva.
      { kinds: [NGE_KIND.request], "#p": [storePubkey] },
      {
        onevent: (ev) => {
          if (ev.kind !== NGE_KIND.request || !verifyEvent(ev)) return;
          if (!ev.tags.some((t) => t[0] === "p" && t[1] === storePubkey)) return;
          void handleRequest(pool, sk, ev).catch((err) =>
            console.error(`[nge] handleRequest lanzó (no debería):`, err),
          );
        },
        onclose: () => {
          // Relay caído o socket muerto: resuscribir con backoff. El cliente
          // reenvía sus requests (§6.1), así que lo perdido llega de nuevo.
          setTimeout(subscribe, 10_000).unref?.();
        },
      },
    );
  };
  subscribe();
  console.log(`[nge] servicio NGE v2 escuchando kind:${NGE_KIND.request} para ${nip19.npubEncode(storePubkey)}`);
}
