import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import {
  normalizePercent,
  providerShareFromStoreFee,
} from "@/lib/economy-settings";
import { prisma } from "@/lib/prisma";
import { revalidateCatalog } from "@/lib/store-catalog";

// Estados de apuesta con dinero en vuelo. Si el juego tiene alguna apuesta asi,
// no se borra: perderiamos el rastro del dinero en custodia.
const ACTIVE_BET_STATES = [
  "created",
  "pending_deposits",
  "ready",
  "settling",
  "refunding",
];

// Ajusta el reparto de ventas de un juego puntual. La UI lo expresa como
// "% Luna Negra"; internamente el juego guarda el % del proveedor.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  let storeFeePct: number;
  try {
    storeFeePct = normalizePercent(
      body.storeFeePct,
      "La comision de tienda",
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Porcentaje invalido" },
      { status: 400 },
    );
  }

  const existing = await prisma.game.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  const game = await prisma.game.update({
    where: { id },
    data: { revenueShare: providerShareFromStoreFee(storeFeePct) },
    include: { provider: true },
  });
  revalidateCatalog();
  return NextResponse.json({ game });
}

// Borra un juego del catalogo, incluso si usuarios ya lo tienen en su biblioteca.
// Limpia en cascada todo lo que cuelga del juego; no toca juegos con apuestas
// activas o dinero en custodia.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  const activeBets = await prisma.bet.count({
    where: { gameId: id, status: { in: ACTIVE_BET_STATES } },
  });
  if (activeBets > 0) {
    return NextResponse.json(
      {
        error:
          "El juego tiene apuestas activas con escrow retenido. Resuelve o reembolsa esas apuestas antes de borrarlo.",
      },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    const bets = await tx.bet.findMany({
      where: { gameId: id },
      select: { id: true },
    });
    const betIds = bets.map((b) => b.id);
    if (betIds.length > 0) {
      await tx.ledgerEntry.deleteMany({ where: { betId: { in: betIds } } });
      await tx.betParticipant.deleteMany({ where: { betId: { in: betIds } } });
      await tx.bet.deleteMany({ where: { id: { in: betIds } } });
    }

    await tx.leaderboard.deleteMany({ where: { gameId: id } });
    await tx.room.deleteMany({ where: { gameId: id } });
    await tx.review.deleteMany({ where: { gameId: id } });
    await tx.purchase.deleteMany({ where: { gameId: id } });

    await tx.game.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
