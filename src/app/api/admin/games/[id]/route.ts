import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";

// Estados de apuesta con dinero "en vuelo" (escrow retenido o liquidando). Si el
// juego tiene alguna apuesta así, NO se borra: perderíamos el rastro del dinero
// en custodia. Hay que resolver/reembolsar esas apuestas primero.
const ACTIVE_BET_STATES = [
  "created",
  "pending_deposits",
  "ready",
  "settling",
  "refunding",
];

// Borra un juego del catálogo, incluso si usuarios ya lo tienen en su biblioteca.
// Limpia en cascada todo lo que cuelga del juego (el schema no define
// onDelete: Cascade para estas relaciones): compras (entitlements/biblioteca),
// reseñas, salas, marcadores y apuestas ya finalizadas con su ledger.
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

  // Guardia: no borrar si hay apuestas con dinero en custodia.
  const activeBets = await prisma.bet.count({
    where: { gameId: id, status: { in: ACTIVE_BET_STATES } },
  });
  if (activeBets > 0) {
    return NextResponse.json(
      {
        error:
          "El juego tiene apuestas activas con escrow retenido. Resolvé o reembolsá esas apuestas antes de borrarlo.",
      },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    // Apuestas (ya finalizadas) y sus dependientes.
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

    // Marcadores (Score cae en cascada vía onDelete: Cascade en Leaderboard).
    await tx.leaderboard.deleteMany({ where: { gameId: id } });

    // Salas, reseñas y compras (biblioteca/entitlements).
    await tx.room.deleteMany({ where: { gameId: id } });
    await tx.review.deleteMany({ where: { gameId: id } });
    await tx.purchase.deleteMany({ where: { gameId: id } });

    await tx.game.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
