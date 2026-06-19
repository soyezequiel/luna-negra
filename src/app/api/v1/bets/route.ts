import { NextResponse } from "next/server";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import {
  validateCreateBet,
  buildContractText,
  computeContractHash,
} from "@/lib/escrow";
import { computeEconomics } from "@/lib/escrow-math";
import { publishContract } from "@/lib/nostr-server";
import { msatToSats } from "@/lib/money";
import {
  BET_MIN_SATS,
  BET_MAX_SATS,
  BET_FEE_PCT,
  BET_FEE_MIN_SATS,
  BET_FEE_MIN_MSAT,
  DEPOSIT_WINDOW_MS,
} from "@/lib/escrow-config";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiError, corsPreflight, CORS } from "@/lib/api";
import { beginIdempotent } from "@/lib/idempotency";

export function OPTIONS() {
  return corsPreflight();
}

type Result = { status: number; body: unknown };
const err = (code: string, message: string, status: number): Result => ({
  status,
  body: { error: { code, message } },
});

// Lógica de crear apuesta, devuelve {status, body} (para idempotencia).
async function createBet(bodyText: string, providerId: string): Promise<Result> {
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return err("BAD_JSON", "Body inválido", 400);
  }
  const v = validateCreateBet(body as object, {
    minSats: BET_MIN_SATS,
    maxSats: BET_MAX_SATS,
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

  const users = await prisma.user.findMany({
    where: { pubkey: { in: v.pubkeys } },
  });
  if (users.length !== v.pubkeys.length) {
    return err(
      "PARTICIPANT_NOT_REGISTERED",
      "Todos los participantes deben tener cuenta en Luna Negra",
      400,
    );
  }

  const participantNpubs = users.map((u) => nip19.npubEncode(u.pubkey));
  const depositDeadline = new Date(Date.now() + DEPOSIT_WINDOW_MS);
  const bet = await prisma.bet.create({
    data: {
      gameId: game.id,
      providerId: game.providerId,
      status: "pending_deposits",
      stakeMsat: v.stakeMsat,
      feePct: BET_FEE_PCT,
      victoryCondition: v.victoryCondition,
      roomId: v.roomId,
      metadataJson: v.metadataJson,
      depositDeadline,
      participants: {
        create: users.map((u) => ({
          userId: u.id,
          npub: nip19.npubEncode(u.pubkey),
        })),
      },
    },
  });

  const contractHash = computeContractHash({
    betId: bet.id,
    gameId: game.id,
    stakeMsat: v.stakeMsat,
    feePct: BET_FEE_PCT,
    victoryCondition: v.victoryCondition,
    npubs: participantNpubs,
  });

  // Publicar contrato inmutable en Nostr (invariante de confianza).
  const content = buildContractText({
    betId: bet.id,
    gameTitle: game.title,
    npubs: v.npubs,
    stakeSats: Number(msatToSats(v.stakeMsat)),
    victoryCondition: v.victoryCondition,
    feePct: BET_FEE_PCT,
    feeMinSats: BET_FEE_MIN_SATS,
    providerName: game.provider.name,
  });
  const tags: string[][] = [
    ["t", "lunanegra:bet"],
    ["bet", bet.id],
    ["terms", contractHash],
    ...v.pubkeys.map((pk) => ["p", pk]),
  ];
  const contractEventId = await publishContract(content, tags);
  await prisma.bet.update({
    where: { id: bet.id },
    data: { contractHash, ...(contractEventId ? { contractEventId } : {}) },
  });

  const econ = computeEconomics({
    stakeMsat: v.stakeMsat,
    participantCount: v.pubkeys.length,
    feePct: BET_FEE_PCT,
    feeMinMsat: BET_FEE_MIN_MSAT,
  });

  return {
    status: 201,
    body: {
      betId: bet.id,
      contractEventId,
      depositDeadline: depositDeadline.toISOString(),
      stakeSats: Number(msatToSats(v.stakeMsat)),
      potTargetSats: Number(msatToSats(econ.potMsat)),
      feePct: BET_FEE_PCT,
      feeBps: econ.feeBps,
      feeSats: Number(msatToSats(econ.feeMsat)),
      netPayoutSats: Number(msatToSats(econ.netMsat)),
      roomId: v.roomId,
      metadata: v.metadataJson ? JSON.parse(v.metadataJson) : null,
    },
  };
}

export async function POST(req: Request) {
  // 1) Auth: API key del proveedor
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError(
      "INVALID_API_KEY",
      "API key inválida (Authorization: Bearer ln_sk_…)",
      401,
    );
  }

  const rl = await checkRateLimit(`bet-create:${providerId}`, 20, 60_000);
  if (!rl.success) {
    return apiError("RATE_LIMITED", "Demasiados intentos", 429, rateLimitHeaders(rl));
  }

  // 2) Idempotencia (opcional): reintentos con la misma key no duplican apuestas.
  const idemKey = req.headers.get("idempotency-key")?.trim() || null;
  let idem: Awaited<ReturnType<typeof beginIdempotent>> | null = null;
  if (idemKey) {
    const r = await beginIdempotent(providerId, idemKey);
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
  const result = await createBet(bodyText, providerId);

  // 4) Guardar la respuesta (éxito) o liberar la key (error → permite reintento).
  if (idem && idem.kind === "fresh") {
    if (result.status === 201) await idem.commit(result.status, result.body);
    else await idem.release();
  }

  return NextResponse.json(result.body, { status: result.status, headers: CORS });
}
