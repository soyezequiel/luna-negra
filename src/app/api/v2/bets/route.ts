import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { verifyApiKeyFull } from "@/lib/api-keys";
import { trackIntegration } from "@/lib/integration-telemetry";
import { validateCreateBet, computeContractHash } from "@/lib/escrow";
import {
  buildContractTextV2,
  buildContractTagsV2,
} from "@/lib/escrow-v2";
import { computeEconomics } from "@/lib/escrow-math";
import { getEconomySettings, resolveBetFees } from "@/lib/economy-settings";
import {
  ensureStoreZapProfile,
  publishContract,
  getStorePubkey,
} from "@/lib/nostr-server";
import { msatToSats } from "@/lib/money";
import { RELAYS } from "@/lib/constants";
import { siteUrl } from "@/lib/site-url";
import {
  BET_MIN_SATS,
  BET_MAX_SATS,
  BET_MAX_ANONYMOUS_SEATS,
  BET_FEE_MIN_SATS,
  BET_FEE_MIN_MSAT,
  DEPOSIT_WINDOW_MS,
  BETS_V2_ENABLED,
} from "@/lib/escrow-v2-config";
import { createGuestUsers } from "@/lib/guest-users";
import { publishNgpBetState, ensureNgpEscrowTerms } from "@/lib/ngp-bet-state";
import { ensureCustodialDepositInvoiceV2 } from "@/lib/zap-bet";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiError, corsPreflight, CORS } from "@/lib/api";
import { beginIdempotent } from "@/lib/idempotency";
import { notifyOperationalError } from "@/lib/discord";

export function OPTIONS() {
  return corsPreflight();
}

type Result = { status: number; body: unknown };
const err = (code: string, message: string, status: number): Result => ({
  status,
  body: { error: { code, message } },
});

/**
 * Publica el evento ancla del contrato v2 (kind:1). A diferencia de v1, el ancla
 * es un invariante DURO: los depósitos y la liquidación cuelgan de él, así que
 * sin ancla no puede haber apuesta.
 *  - Con nsec configurado y algún relay que aceptó → devuelve el event id.
 *  - Con nsec pero NINGÚN relay lo aceptó → null (el caller falla con 503).
 *  - Sin nsec (dev) → placeholder `dev-anchor-<hex>` para probar el flujo sin claves
 *    (mismo criterio que los invoices `lnbc-dev-...` de v1).
 */
async function publishBetAnchor(
  content: string,
  tags: string[][],
): Promise<{ anchorEventId: string; dev: boolean } | null> {
  if (!getStorePubkey()) {
    return { anchorEventId: `dev-anchor-${randomBytes(16).toString("hex")}`, dev: true };
  }
  const id = await publishContract(content, tags);
  return id ? { anchorEventId: id, dev: false } : null;
}

// Lógica de crear apuesta v2, devuelve {status, body} (para idempotencia).
async function createZapBet(
  bodyText: string,
  providerId: string,
  keyGameId: string | null,
  baseUrl: string,
): Promise<Result> {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return err("BAD_JSON", "Body inválido", 400);
  }
  const v = validateCreateBet(body as object, {
    minSats: BET_MIN_SATS,
    maxSats: BET_MAX_SATS,
    maxSeats: BET_MAX_ANONYMOUS_SEATS,
    defaultGameId: keyGameId,
  });
  if (!v.ok) return err(v.code, v.error, 400);

  const game = await prisma.game.findUnique({
    where: { id: v.gameId },
    include: { provider: true },
  });
  if (!game) return err("GAME_NOT_FOUND", "Juego no encontrado", 404);
  if (game.providerId !== providerId) {
    return err("NOT_GAME_OWNER", "El juego no es de tu proveedor", 403);
  }

  if (!(await ensureStoreZapProfile(baseUrl))) {
    return err(
      "STORE_ZAP_PROFILE_FAILED",
      "No se pudo publicar la Lightning Address de Luna Negra en Nostr",
      503,
    );
  }

  // Participantes EN ORDEN (asiento 1..N): npub registrado o identidad efímera.
  // Idéntico a v1: pozos mixtos, degradado opt-in de npubs desconocidos a invitados.
  const unknownAsGuest =
    (body as { unknownNpubsAsGuests?: unknown }).unknownNpubsAsGuests === true;
  let downgradedCount = 0;
  let participantSeats: { userId: string; npub: string; pubkey: string }[];
  {
    const guestCount = v.seatSpecs.filter((s) => s.kind === "guest").length;
    const realPubkeys = v.seatSpecs.flatMap((s) => (s.kind === "npub" ? [s.pubkey] : []));
    const users = realPubkeys.length
      ? await prisma.user.findMany({ where: { pubkey: { in: realPubkeys } } })
      : [];
    const userByPubkey = new Map(users.map((u) => [u.pubkey, u]));
    const unknownPubkeys = realPubkeys.filter((pk) => !userByPubkey.has(pk));
    if (unknownPubkeys.length && !unknownAsGuest) {
      return err(
        "PARTICIPANT_NOT_REGISTERED",
        "Todos los participantes con npub deben tener cuenta en Luna Negra",
        400,
      );
    }
    downgradedCount = unknownPubkeys.length;
    const guests = guestCount + downgradedCount
      ? await createGuestUsers(guestCount + downgradedCount)
      : [];
    let guestIdx = 0;
    participantSeats = v.seatSpecs.map((seat) => {
      if (seat.kind === "guest") {
        const g = guests[guestIdx++];
        return { userId: g.userId, npub: g.npub, pubkey: g.pubkey };
      }
      const u = userByPubkey.get(seat.pubkey);
      if (!u) {
        const g = guests[guestIdx++];
        return { userId: g.userId, npub: g.npub, pubkey: g.pubkey };
      }
      return { userId: u.id, npub: nip19.npubEncode(u.pubkey), pubkey: u.pubkey };
    });
  }

  const participantNpubs = participantSeats.map((p) => p.npub);
  const depositDeadline = new Date(Date.now() + DEPOSIT_WINDOW_MS);
  const economy = await getEconomySettings();
  const { feePct, devFeePct } = resolveBetFees({
    game: { betFeePct: game.betFeePct, betDevFeePct: game.betDevFeePct },
    provider: { betDevFeePct: game.provider.betDevFeePct },
    economy,
  });

  const bet = await prisma.zapBet.create({
    data: {
      gameId: game.id,
      providerId: game.providerId,
      status: "pending_deposits",
      stakeMsat: v.stakeMsat,
      feePct,
      devFeePct,
      victoryCondition: v.victoryCondition,
      roomId: v.roomId,
      metadataJson: v.metadataJson,
      depositDeadline,
      participants: {
        create: participantSeats.map((p) => ({
          userId: p.userId,
          npub: p.npub,
          pubkey: p.pubkey,
        })),
      },
    },
  });

  const contractHash = computeContractHash({
    betId: bet.id,
    gameId: game.id,
    stakeMsat: v.stakeMsat,
    feePct,
    devFeePct,
    victoryCondition: v.victoryCondition,
    npubs: participantNpubs,
  });

  // Publicar el ancla ANTES del primer sat. Guard duro: sin ancla no hay apuesta.
  const content = buildContractTextV2({
    betId: bet.id,
    gameTitle: game.title,
    npubs: participantNpubs,
    stakeSats: Number(msatToSats(v.stakeMsat)),
    victoryCondition: v.victoryCondition,
    feePct,
    devFeePct,
    feeMinSats: BET_FEE_MIN_SATS,
    providerName: game.provider.name,
    detailUrl: `${baseUrl}/apuestas/${bet.id}`,
  });
  const storePubkey = getStorePubkey();
  const tags = buildContractTagsV2({
    betId: bet.id,
    contractHash,
    zapReceiver: storePubkey
      ? { pubkey: storePubkey, relay: RELAYS[RELAYS.length - 1] }
      : null,
  });
  const anchor = await publishBetAnchor(content, tags);
  if (!anchor) {
    // Los relays rechazaron el ancla (con nsec configurado): no hay apuesta viable.
    await prisma.zapBet.update({
      where: { id: bet.id },
      data: { status: "cancelled_admin", contractHash },
    });
    return err(
      "ANCHOR_PUBLISH_FAILED",
      "No se pudo publicar el contrato en ningún relay; la apuesta no se creó",
      503,
    );
  }
  await prisma.zapBet.update({
    where: { id: bet.id },
    // El ancla v2 es el post-contrato kind:1 que publica la tienda → `K`=1 en el
    // comentario de participación (NIP-22).
    data: { contractHash, anchorEventId: anchor.anchorEventId, anchorEventKind: 1 },
  });

  // Estado NGP (kind:31340, escrow transparente): sombra observacional del estado
  // interno; junto con las terms del escrow. Best-effort, nunca bloquea la creación.
  after(async () => {
    await ensureNgpEscrowTerms();
    await publishNgpBetState(bet.id);
  });

  // Pre-emitir EN SEGUNDO PLANO los invoices custodiales (invitados y cuentas por
  // email): cada uno hace un make_invoice por NWC (~2-4s) que, sin esto, pagaba el
  // PRIMER GET de detalle — o sea, el jugador esperando el QR. Corre tras enviar la
  // respuesta (after); idempotente y con claim atómico en ensureDepositInvoiceV2,
  // así que si un GET llega antes de que termine, uno de los dos reusa el del otro.
  // Best-effort: si falla, el GET de detalle lo emite on-demand como siempre.
  after(async () => {
    try {
      const fresh = await prisma.zapBet.findUnique({
        where: { id: bet.id },
        include: {
          participants: { include: { user: { select: { nsecEnc: true } } } },
        },
      });
      if (!fresh || fresh.status !== "pending_deposits") return;
      await Promise.allSettled(
        fresh.participants
          .filter((p) => p.user?.nsecEnc && !p.depositInvoice)
          .map((p) => ensureCustodialDepositInvoiceV2(fresh, p, baseUrl)),
      );
    } catch {
      /* best-effort: el GET de detalle emite on-demand */
    }
  });

  const econ = computeEconomics({
    stakeMsat: v.stakeMsat,
    participantCount: v.seatCount,
    feePct,
    devFeePct,
    feeMinMsat: BET_FEE_MIN_MSAT,
  });

  trackIntegration("bets", { providerId, gameId: game.id });

  const participants = await prisma.zapBetParticipant.findMany({
    where: { betId: bet.id },
    select: { id: true, npub: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    status: 201,
    body: {
      betId: bet.id,
      apiVersion: 2,
      anchorEventId: anchor.anchorEventId,
      depositDeadline: depositDeadline.toISOString(),
      stakeSats: Number(msatToSats(v.stakeMsat)),
      potTargetSats: Number(msatToSats(econ.potMsat)),
      feePct,
      feeBps: econ.feeBps,
      feeSats: Number(msatToSats(econ.feeMsat)),
      devFeePct,
      devFeeBps: econ.devFeeBps,
      devFeeSats: Number(msatToSats(econ.devFeeMsat)),
      netPayoutSats: Number(msatToSats(econ.netMsat)),
      roomId: v.roomId,
      metadata: v.metadataJson ? JSON.parse(v.metadataJson) : null,
      // Handles de depósito por asiento (participantId): el flujo de zap los usa
      // para prepare/invoice. El npub se incluye siempre en v2 porque el depósito
      // por zap requiere que el proveedor sepa qué asiento firma cada apostador.
      participants: participants.map((p, i) => ({
        seat: i + 1,
        npub: p.npub,
        participantId: p.id,
      })),
    },
  };
}

export async function POST(req: Request) {
  if (!BETS_V2_ENABLED) {
    return apiError("BETS_V2_DISABLED", "Las apuestas v2 están desactivadas", 503);
  }

  // 1) Auth: API key del proveedor (con el juego al que quedó acotada, si aplica)
  const identity = await verifyApiKeyFull(req);
  if (!identity) {
    return apiError(
      "INVALID_API_KEY",
      "API key inválida (Authorization: Bearer ln_sk_…)",
      401,
    );
  }
  const { providerId, gameId: keyGameId } = identity;

  const rl = await checkRateLimit(`bet-v2-create:${providerId}`, 20, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
  }

  // 2) Idempotencia (opcional): reintentos con la misma key no duplican apuestas.
  const idemKey = req.headers.get("idempotency-key")?.trim() || null;
  let idem: Awaited<ReturnType<typeof beginIdempotent>> | null = null;
  if (idemKey) {
    const r = await beginIdempotent(providerId, `v2:${idemKey}`);
    if (r.kind === "replay") {
      return NextResponse.json(r.body, { status: r.statusCode, headers: CORS });
    }
    if (r.kind === "in_progress") {
      return apiError(
        "IDEMPOTENCY_IN_PROGRESS",
        "Otra request con esta Idempotency-Key está en curso",
        409,
      );
    }
    idem = r;
  }

  // 3) Crear la apuesta
  const bodyText = await req.text();
  const result = await createZapBet(bodyText, providerId, keyGameId, siteUrl(req));
  if (result.status >= 500) {
    await notifyOperationalError({
      source: "api-v2-bet-create",
      error: new Error("No se pudo crear la apuesta v2"),
      fingerprint: `api-v2-bet-create:${providerId}:${result.status}`,
      context: { providerId, status: result.status, response: result.body },
    });
  }

  // 4) Guardar la respuesta (éxito) o liberar la key (error → permite reintento).
  if (idem && idem.kind === "fresh") {
    if (result.status === 201) await idem.commit(result.status, result.body);
    else await idem.release();
  }

  return NextResponse.json(result.body, { status: result.status, headers: CORS });
}
