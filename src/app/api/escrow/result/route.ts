import { NextResponse } from "next/server";
import { verifyEvent, type Event } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { recordOutflow } from "@/lib/ledger";
import { computeContractHash } from "@/lib/escrow";
import { payParticipant } from "@/lib/escrow-payout";
import { publishSignedEvent } from "@/lib/nostr-server";

const MAX_AGE = 1800; // 30 min

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(req: Request) {
  const parsed = await req.json().catch(() => ({}));
  const ev = parsed?.event as Event | undefined;
  if (!ev || typeof ev !== "object" || !Array.isArray(ev.tags)) {
    return fail("BAD_EVENT", "Evento inválido", 400);
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - (ev.created_at ?? 0)) > MAX_AGE) {
    return fail("STALE", "Evento expirado", 400);
  }
  if (!verifyEvent(ev)) return fail("BAD_SIGNATURE", "Firma inválida", 401);

  const betId = ev.tags.find((t) => t[0] === "bet")?.[1];
  if (!betId) return fail("MISSING_BET", "Falta el tag bet", 400);

  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { provider: { include: { owner: true } }, participants: true },
  });
  if (!bet) return fail("BET_NOT_FOUND", "Apuesta no encontrada", 404);

  // El firmante debe ser el dueño del proveedor del juego.
  if (ev.pubkey !== bet.provider.owner.pubkey) {
    return fail("WRONG_SIGNER", "El resultado no está firmado por el proveedor", 403);
  }

  if (bet.status === "settled") return fail("ALREADY_RESOLVED", "Ya resuelta", 409);
  if (["cancelled_incomplete", "cancelled_admin", "refunded_timeout"].includes(bet.status)) {
    return fail("TOO_LATE", "La apuesta ya fue reembolsada/cancelada", 410);
  }

  // Claim ready → settling (solo un request gana la carrera).
  const claimed = await prisma.bet.updateMany({
    where: { id: betId, status: "ready" },
    data: { status: "settling" },
  });
  if (claimed.count !== 1) {
    return fail("NOT_READY", "La apuesta no está lista para resolver", 409);
  }

  // Integridad: los términos vivos deben coincidir con el contrato firmado.
  // Si alguien alteró stake/fee/participantes después de firmar, NO pagamos:
  // revertimos a ready → el timeout de resolución reembolsará a todos (seguro).
  if (bet.contractHash) {
    const liveHash = computeContractHash({
      betId: bet.id,
      gameId: bet.gameId,
      stakeMsat: bet.stakeMsat,
      feePct: bet.feePct,
      victoryCondition: bet.victoryCondition,
      npubs: bet.participants.map((p) => p.npub),
    });
    if (liveHash !== bet.contractHash) {
      await prisma.bet.updateMany({
        where: { id: betId, status: "settling" },
        data: { status: "ready" },
      });
      console.error(
        `[escrow] términos alterados en ${betId}: contrato=${bet.contractHash} vivo=${liveHash}`,
      );
      return fail(
        "CONTRACT_MISMATCH",
        "Los términos no coinciden con el contrato firmado; no se paga",
        409,
      );
    }
  }

  // Ganadores declarados (tags "winner") que sean participantes.
  const winnerNpubs = ev.tags.filter((t) => t[0] === "winner").map((t) => t[1]);
  const winners = bet.participants.filter((p) => winnerNpubs.includes(p.npub));
  if (winners.length === 0) {
    await prisma.bet.updateMany({
      where: { id: betId, status: "settling" },
      data: { status: "ready" },
    });
    return fail("INVALID_WINNER", "No se declaró un ganador válido", 400);
  }

  // Montos (msat). El pozo = stake * cantidad de participantes (todos pagaron al estar ready).
  const pot = bet.stakeMsat * BigInt(bet.participants.length);
  const feeMsat = (pot * BigInt(bet.feePct)) / 100n;
  const winnings = pot - feeMsat;
  const perWinner = winnings / BigInt(winners.length);
  const dust = winnings - perWinner * BigInt(winners.length);

  // Fee de la casa (la guarda Luna Negra; se asienta al toque).
  const feeRec = await recordOutflow({
    betId,
    userId: null,
    kind: "fee",
    amountMsat: feeMsat + dust,
    idempotencyKey: `fee:${betId}`,
  });
  if (feeRec.ok) {
    await prisma.ledgerEntry.update({
      where: { idempotencyKey: `fee:${betId}` },
      data: { status: "settled" },
    });
  }

  const resultVal = winners.length > 1 ? "tie" : "won";
  for (const w of winners) {
    await prisma.betParticipant.update({ where: { id: w.id }, data: { result: resultVal } });
    await payParticipant({ bet, participant: w, amountMsat: perWinner, kind: "payout" });
  }
  await prisma.betParticipant.updateMany({
    where: { betId, id: { notIn: winners.map((w) => w.id) } },
    data: { result: "lost" },
  });

  await prisma.bet.update({
    where: { id: betId },
    data: { status: "settled", settledAt: new Date(), resultEventId: ev.id },
  });

  // Republicar el evento firmado del proveedor (prueba en Nostr).
  await publishSignedEvent(ev);

  return NextResponse.json({ ok: true });
}
