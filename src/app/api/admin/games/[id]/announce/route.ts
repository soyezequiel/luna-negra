import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { syncGameToNostr } from "@/lib/announce-game";

// (Re)publica en Nostr el artículo NIP-23 de un juego ya publicado. Sirve para
// juegos aprobados antes de esta feature (que tenían una nota kind:1), artículos
// que ningún relay aceptó, o para forzar una re-firma. Como el artículo es
// direccionable, re-publicar mantiene la coordenada y no rompe comentarios.
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

  const updated = await syncGameToNostr(game, req);
  if (!updated.nostrCoord) {
    return NextResponse.json(
      { error: "No se pudo publicar el artículo (¿falta LUNA_NEGRA_NSEC o relays?)" },
      { status: 502 },
    );
  }
  return NextResponse.json({ game: updated });
}
