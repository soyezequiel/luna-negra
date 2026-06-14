import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { announceGame } from "@/lib/announce-game";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.game.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  let game = await prisma.game.update({
    where: { id },
    data: { status: "published" },
  });
  // Anuncio raíz en Nostr (idempotente): solo si todavía no lo tiene.
  game = await announceGame(game, req);
  return NextResponse.json({ game });
}
