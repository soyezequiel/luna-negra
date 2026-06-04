import { NextResponse } from "next/server";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { verifyNip98 } from "@/lib/nip98";
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

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(req: Request) {
  const bodyText = await req.text();

  // 1) Auth NIP-98 del game server
  const signer = verifyNip98(req.headers.get("authorization"), "POST", bodyText);
  if (!signer) return fail("INVALID_SIGNATURE", "Firma NIP-98 inválida", 401);

  const rl = await checkRateLimit(`bet-create:${signer}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos", code: "RATE_LIMITED" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  // 2) Validación de forma
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return fail("BAD_JSON", "Body inválido", 400);
  }
  const v = validateCreateBet(body as object, {
    minSats: BET_MIN_SATS,
    maxSats: BET_MAX_SATS,
  });
  if (!v.ok) return fail(v.code, v.error, 400);

  // 3) El juego existe y el firmante es el dueño del proveedor
  const game = await prisma.game.findUnique({
    where: { id: v.gameId },
    include: { provider: { include: { owner: true } } },
  });
  if (!game) return fail("GAME_NOT_FOUND", "Juego no encontrado", 404);
  if (game.provider.owner.pubkey !== signer) {
    return fail("NOT_GAME_OWNER", "No sos el dueño de este juego", 403);
  }

  // 4) Todos los participantes deben ser usuarios de Luna Negra
  const users = await prisma.user.findMany({
    where: { pubkey: { in: v.pubkeys } },
  });
  if (users.length !== v.pubkeys.length) {
    return fail(
      "PARTICIPANT_NOT_REGISTERED",
      "Todos los participantes deben tener cuenta en Luna Negra",
      400,
    );
  }

  // 5) Crear la apuesta + participantes
  // npubs canónicos (re-encodeados desde el pubkey): es la MISMA representación
  // que se guarda y que se usa al verificar el hash en la liquidación.
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
        create: users.map((u) => ({ userId: u.id, npub: nip19.npubEncode(u.pubkey) })),
      },
    },
  });

  // Huella de los términos: se firma en el evento Nostr y se verifica antes de pagar.
  const contractHash = computeContractHash({
    betId: bet.id,
    gameId: game.id,
    stakeMsat: v.stakeMsat,
    feePct: BET_FEE_PCT,
    victoryCondition: v.victoryCondition,
    npubs: participantNpubs,
  });

  // 6) Publicar contrato inmutable en Nostr (best-effort)
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
    { betId: bet.id, contractEventId, depositDeadline: depositDeadline.toISOString() },
    { status: 201 },
  );
}
