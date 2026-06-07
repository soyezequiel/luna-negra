import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { announceGame } from "@/lib/announce-game";

// Re-anuncia en Nostr un juego ya publicado que aún no tiene posteo raíz
// (juegos aprobados antes de esta feature, o anuncios que ningún relay aceptó).
export async function POST(
  req: Request,
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
  if (game.status !== "published") {
    return NextResponse.json(
      { error: "El juego no está publicado" },
      { status: 400 },
    );
  }
  if (game.nostrEventId) {
    return NextResponse.json({ game, alreadyAnnounced: true });
  }

  const updated = await announceGame(game, req);
  if (!updated.nostrEventId) {
    return NextResponse.json(
      { error: "No se pudo publicar el anuncio (¿falta LUNA_NEGRA_NSEC o relays?)" },
      { status: 502 },
    );
  }
  return NextResponse.json({ game: updated });
}
