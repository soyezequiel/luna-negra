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
import { payParticipantV2 } from "@/lib/escrow-v2-payout";
import { isTerminal } from "@/lib/bet-state";
import { ngeStatus, ngeStatusOf } from "@/lib/bet-status-public";
import { ngeMetaOf, type NgeSeatMeta } from "@/lib/nge-meta";
import { notifyNgeBetUpdated, ngePool, publishFirstAck } from "@/lib/nge-notify";
import { settleNgeWithManagedOracle } from "@/lib/nge-settle";
import { emitBetCancelledV2, emitBetRefundedV2 } from "@/lib/webhooks";
import { beginIdempotent } from "@/lib/idempotency";
import { publishNgpBetState, ensureNgpEscrowTerms } from "@/lib/ngp-bet-state";
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
//  - El mapeo seatId↔asiento, el `clientRef` y la `visibility` viajan en
//    ZapBet.metadataJson bajo la clave `nge`. La liquidación pública (31340 +
//    1341 + nota social) corre por la capa NGP como en cualquier apuesta v2;
//    `visibility: "unlisted"` omite la sombra 31340 y la nota social de ESA
//    apuesta (ver isUnlistedBet en ngp-bet-state.ts).
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
/** Rate limiting por credencial (spec §7, RATE_LIMITED; anunciado en get_info.limits). */
const NGE_CREATE_BET_PER_MIN = Number(process.env.NGE_CREATE_BET_PER_MIN ?? 10);
const NGE_MAX_PENDING_BETS = Number(process.env.NGE_MAX_PENDING_BETS ?? 20);
/** Ventana de disputa (spec §7.1): con pozo ≥ el umbral, el payout se difiere.
 *  0 en cualquiera de los dos = liquidación inmediata (comportamiento v1.0). */
const NGE_SETTLE_DELAY_SEC = Number(process.env.NGE_SETTLE_DELAY_SEC ?? 0);
const NGE_SETTLE_DELAY_MIN_POT_SATS = Number(process.env.NGE_SETTLE_DELAY_MIN_POT_SATS ?? 0);
const settleDelayActive = NGE_SETTLE_DELAY_SEC > 0;

// Estado a nivel PROCESO en globalThis: Turbopack duplica módulos server en
// varios chunks; con `let` locales habría un servicio (y un caché) por copia.
declare global {
  // eslint-disable-next-line no-var
  var lunaNgeServiceStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var lunaNgeResponseCache: Map<string, { ev: Event | null; expiresAt: number }> | undefined;
  // eslint-disable-next-line no-var
  var lunaNgeDepositCheckAt: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var lunaNgeCreateWindow: Map<string, number[]> | undefined;
}
const responseCache = (globalThis.lunaNgeResponseCache ??= new Map());
const depositCheckAt = (globalThis.lunaNgeDepositCheckAt ??= new Map());
const createWindow = (globalThis.lunaNgeCreateWindow ??= new Map());

/** Ventana deslizante de 60 s de `create_bet` por juego. Registra el intento. */
function createBetRateExceeded(gameId: string): boolean {
  const nowMs = Date.now();
  const hits = (createWindow.get(gameId) ?? []).filter((t: number) => nowMs - t < 60_000);
  if (hits.length >= NGE_CREATE_BET_PER_MIN) {
    createWindow.set(gameId, hits);
    return true;
  }
  hits.push(nowMs);
  createWindow.set(gameId, hits);
  return false;
}

const nowSec = () => Math.floor(Date.now() / 1000);
const sats = (msat: bigint) => Number(msatToSats(msat));

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
    // Piso de comisión (v1.1): para que el cliente pueda auditar la liquidación
    // (auditSettlement del SDK) sin adivinar.
    feeMinSats: BET_FEE_MIN_SATS,
    // Capacidad declarada del ESCROW (no del canal): Luna liquida en público
    // (formato NGP: contrato + 31340 + 1341 + 9735). El juego puede pedir
    // "unlisted" por apuesta para omitir la sombra 31340 y la nota social.
    transparency: "public",
    visibilityOptions: ["public", "unlisted"],
    // Push v1.1 (spec §9): el escrow emite bet_updated por kind:24942.
    notifications: ["bet_updated"],
    // Límites por credencial (v1.1): excederlos → RATE_LIMITED.
    limits: { createBetPerMin: NGE_CREATE_BET_PER_MIN, maxPendingBets: NGE_MAX_PENDING_BETS },
    // Ventana de disputa (v1.1, spec §7.1). 0 = liquidación inmediata.
    settleDelaySec: settleDelayActive ? NGE_SETTLE_DELAY_SEC : 0,
    settleDelayMinPotSats: settleDelayActive ? NGE_SETTLE_DELAY_MIN_POT_SATS : 0,
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
  // Sala/partida del juego (spec §7): correlación y display ("Sala" en el detalle).
  // Opaca para el protocolo: no participa de la idempotencia ni del estado.
  const roomId =
    typeof params.roomId === "string" && params.roomId.trim()
      ? params.roomId.trim().slice(0, 128)
      : null;
  // Visibilidad de la liquidación pública (spec §7): "unlisted" omite la sombra
  // 31340 y la nota social de ESTA apuesta. Cualquier otro valor = "public".
  const unlisted = params.visibility === "unlisted";

  // Rate limiting por credencial (spec §7, v1.1). Cada create_bet crea filas,
  // invoices en el nodo y un kind:1 público firmado por la tienda: sin límite,
  // una credencial filtrada (o un juego con un bug en un loop) puede spamear
  // los tres. Reintentos del MISMO evento no llegan acá (dedup por id); los
  // límites viven en get_info.limits.
  if (createBetRateExceeded(cred.gameId)) {
    return fail(
      method,
      "RATE_LIMITED",
      `máximo ${NGE_CREATE_BET_PER_MIN} create_bet por minuto para este juego; reintentá con backoff`,
    );
  }
  const pendingCount = await prisma.zapBet.count({
    where: { gameId: cred.gameId, status: { in: ["created", "pending_deposits"] } },
  });
  if (pendingCount >= NGE_MAX_PENDING_BETS) {
    return fail(
      method,
      "RATE_LIMITED",
      `este juego ya tiene ${pendingCount} apuestas esperando depósitos (máximo ${NGE_MAX_PENDING_BETS}); cancelá o esperá a que expiren`,
    );
  }

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

    // El mapeo NGE va en columnas (v1.1): seatId en el participante, clientRef y
    // visibility en la apuesta. Las filas viejas siguen leyéndose del JSON legacy
    // vía nge-meta.ts; las nuevas ya no lo escriben.
    const bet = await prisma.zapBet.create({
      data: {
        gameId: cred.gameId,
        providerId: cred.game.providerId,
        status: "pending_deposits",
        stakeMsat,
        feePct,
        devFeePct,
        victoryCondition: condition,
        ...(roomId ? { roomId } : {}),
        ...(clientRef ? { ngeClientRef: clientRef } : {}),
        ngeUnlisted: unlisted,
        depositDeadline,
        participants: {
          create: identities.map((g, i) => ({
            userId: g.userId,
            npub: g.npub,
            pubkey: g.pubkey,
            ngeSeatId: seats[i].seatId,
          })),
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
      detailUrl: `${baseUrl()}/apuestas/${bet.id}`,
    });
    const storePubkey = getStorePubkey();
    const tags = buildContractTagsV2({
      betId: bet.id,
      contractHash,
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

    // Sombra pública NGP (kind:31340) + terms del escrow, como el POST REST.
    // Best-effort fuera del camino de respuesta; isUnlistedBet filtra adentro.
    void ensureNgpEscrowTerms().catch(() => {});
    void publishNgpBetState(bet.id).catch(() => {});

    // Respuesta v1.1: el detalle COMPLETO (mismo shape que get_bet) más los
    // handles de depósito. Un solo RPC deja al juego con los QR y el estado
    // inicial — sin get_bet post-creación. Recién creada, el detalle es trivial:
    // nadie depositó y no hay resultado.
    const result = {
      betId: bet.id,
      status: "pending_deposits",
      stakeSats,
      potSats: 0,
      deadlineSec: Math.floor(depositDeadline.getTime() / 1000),
      seats: deposits.map((d) => ({
        seatId: d.seatId,
        deposited: false,
        ...(d.bolt11 ? { bolt11: d.bolt11 } : {}),
        payout: null,
      })),
      result: null,
      deposits,
    };
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
  const meta = ngeMetaOf(bet, bet.participants);
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
  let winners = meta.seats
    .filter((s) => byNpub.get(s.npub)?.result === "won")
    .map((s) => s.seatId);
  // Ventana de disputa (spec §7.1): el resultado ya está FIJADO (no se
  // reescribe) pero el payout espera settleAt — se expone como resolving con
  // los ganadores fijados, para que el juego pueda mostrarlo.
  const inDisputeWindow = bet.status === "ready" && bet.settleAt != null;
  if (inDisputeWindow && bet.pendingWinnersJson) {
    try {
      const fixedNpubs = new Set(JSON.parse(bet.pendingWinnersJson) as string[]);
      winners = meta.seats.filter((s) => fixedNpubs.has(s.npub)).map((s) => s.seatId);
    } catch {
      /* JSON corrupto: se cae al comportamiento sin resultado */
    }
  }
  const hasResult = bet.status === "settled" || bet.status === "voided" || inDisputeWindow;

  return ok(method, {
    betId: bet.id,
    status: ngeStatusOf(bet),
    stakeSats: sats(bet.stakeMsat),
    potSats: sats(bet.stakeMsat) * paidCount,
    deadlineSec: bet.depositDeadline ? Math.floor(bet.depositDeadline.getTime() / 1000) : null,
    ...(inDisputeWindow && bet.settleAt
      ? { settleAt: Math.floor(bet.settleAt.getTime() / 1000) }
      : {}),
    seats,
    result: hasResult ? { winners } : null,
  });
}

async function doReportResult(
  cred: Credential,
  params: Record<string, unknown>,
): Promise<NgeResponsePayload> {
  const method = "report_result";
  const bet = await findBetFor(cred, params.betId);
  if (!bet) return fail(method, "NOT_FOUND", "apuesta no encontrada");
  const meta = ngeMetaOf(bet, bet.participants);
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

  // Ventana de disputa en curso (spec §7.1): el resultado ya está FIJADO. Un
  // reintento idéntico devuelve el mismo estado; uno distinto no reescribe.
  if (bet.status === "ready" && bet.settleAt && bet.pendingWinnersJson) {
    let fixed: string[] = [];
    try {
      fixed = JSON.parse(bet.pendingWinnersJson) as string[];
    } catch {
      /* imposible salvo corrupción manual; cae al mismatch de abajo */
    }
    const same =
      fixed.length === winnerNpubs.length && fixed.every((n) => winnerNpubs.includes(n));
    if (same) {
      return ok(method, {
        ok: true,
        status: "resolving",
        settleAt: Math.floor(bet.settleAt.getTime() / 1000),
      });
    }
    return fail(
      method,
      "ALREADY_SETTLED",
      "el resultado ya está fijado y en ventana de disputa; no se puede reescribir",
    );
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

  // Ventana de disputa (spec §7.1): con pozo grande, el primer report_result
  // FIJA el resultado y difiere el payout a settleAt (el tick lo ejecuta). El
  // claim optimista (pendingWinnersJson null → set) evita que dos requests
  // concurrentes fijen resultados distintos.
  const paidCount = bet.participants.filter((p) => p.depositStatus === "paid").length;
  const potSats = sats(bet.stakeMsat) * paidCount;
  if (settleDelayActive && potSats >= NGE_SETTLE_DELAY_MIN_POT_SATS) {
    const settleAt = new Date(Date.now() + NGE_SETTLE_DELAY_SEC * 1000);
    const claimed = await prisma.zapBet.updateMany({
      where: { id: bet.id, status: "ready", pendingWinnersJson: null },
      data: { pendingWinnersJson: JSON.stringify(winnerNpubs), settleAt },
    });
    if (claimed.count !== 1) {
      return fail(method, "IN_PROGRESS", "otro report_result está fijando el resultado; consultá get_bet");
    }
    void notifyNgeBetUpdated(bet.id);
    return ok(method, {
      ok: true,
      status: "resolving",
      settleAt: Math.floor(settleAt.getTime() / 1000),
    });
  }

  // Sin ventana: liquidación inmediata con el oráculo gestionado (nge-settle.ts,
  // compartido con la ejecución diferida del tick).
  const r = await settleNgeWithManagedOracle(bet.id, winnerNpubs);
  if (r.ok) {
    void notifyNgeBetUpdated(bet.id);
    return ok(method, { ok: true, status: r.finalStatus ?? (r.voided ? "refunded" : "settled") });
  }
  if (r.code === "NOT_READY") {
    const current = await prisma.zapBet.findUnique({ where: { id: bet.id }, select: { status: true } });
    if (current?.status === "settling") {
      return fail(method, "IN_PROGRESS", "la liquidación está en curso; consultá get_bet");
    }
    return fail(method, "NOT_FUNDED", "la apuesta no está lista para resolver");
  }
  return fail(method, r.code, r.message);
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
  void publishNgpBetState(bet.id).catch(() => {});
  void notifyNgeBetUpdated(bet.id);
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
  // First-ack (v1.1): con que UN relay acepte, la response viaja; esperar a los
  // 5 hacía que el más lento mandara la latencia de todo el RPC.
  const okd = await publishFirstAck(pool, RELAYS, ev);
  if (!okd) console.warn(`[nge] ningún relay aceptó la response ${ev.id}`);
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

  // Pool compartido con los pushes 24942 (nge-notify.ts).
  const pool = ngePool();
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
