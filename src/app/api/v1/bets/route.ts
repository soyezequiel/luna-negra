import { NextResponse } from "next/server";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/api-keys";
import {
  validateCreateBet,
  buildContractText,
  computeContractHash,
} from "@/lib/escrow";
import { publishContract } from "@/lib/nostr-server";
import { msatToSats } from "@/lib/money";
import {
  BET_MIN_SATS,
  BET_MAX_SATS,
  BET_FEE_PCT,
  DEPOSIT_WINDOW_MS,
} from "@/lib/escrow-config";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { apiError, corsPreflight, CORS } from "@/lib/api";

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: Request) {
  // 1) Auth: API key del proveedor (Authorization: Bearer ln_sk_…)
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

  // 2) Validación de forma
  const bodyText = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return apiError("BAD_JSON", "Body inválido", 400);
  }
  const v = validateCreateBet(body as object, {
    minSats: BET_MIN_SATS,
    maxSats: BET_MAX_SATS,
  });
  if (!v.ok) return apiError(v.code, v.error, 400);

  // 3) El juego existe y pertenece al proveedor de la API key
  const game = await prisma.game.findUnique({
    where: { id: v.gameId },
    include: { provider: true },
  });
  if (!game) return apiError("GAME_NOT_FOUND", "Juego no encontrado", 404);
  if (game.providerId !== providerId) {
    return apiError("NOT_GAME_OWNER", "El juego no es de tu proveedor", 403);
  }

  // 4) Todos los participantes deben ser usuarios de Luna Negra
  const users = await prisma.user.findMany({
    where: { pubkey: { in: v.pubkeys } },
  });
  if (users.length !== v.pubkeys.length) {
    return apiError(
      "PARTICIPANT_NOT_REGISTERED",
      "Todos los participantes deben tener cuenta en Luna Negra",
      400,
    );
  }

  // 5) Crear la apuesta + participantes
  const participantNpubs = users.map((u) => nip19.npubEncode(u.pubkey));
  const depositDeadline = new Date(Date.now() + DEPOSIT_WINDOW_MS);
  const bet = await prisma.bet.create({
    data: {
      gameId: game.id,
      providerId: game.providerId,
      status: "pending_deposits",
      stakeMsat: v.stakeMsat,
      feePct: BET_FEE_PCT, // lo fija Luna Negra, no el server
      victoryCondition: v.victoryCondition,
      depositDeadline,
      participants: {
        create: users.map((u) => ({
          userId: u.id,
          npub: nip19.npubEncode(u.pubkey),
        })),
      },
    },
  });

  // Huella de los términos: se firma en Nostr y se verifica antes de pagar.
  const contractHash = computeContractHash({
    betId: bet.id,
    gameId: game.id,
    stakeMsat: v.stakeMsat,
    feePct: BET_FEE_PCT,
    victoryCondition: v.victoryCondition,
    npubs: participantNpubs,
  });

  // 6) Publicar contrato inmutable en Nostr (best-effort) — invariante de confianza.
  const content = buildContractText({
    betId: bet.id,
    gameTitle: game.title,
    npubs: v.npubs,
    stakeSats: Number(msatToSats(v.stakeMsat)),
    victoryCondition: v.victoryCondition,
    feePct: BET_FEE_PCT,
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

  return NextResponse.json(
    {
      betId: bet.id,
      contractEventId,
      depositDeadline: depositDeadline.toISOString(),
    },
    { status: 201, headers: CORS },
  );
}
