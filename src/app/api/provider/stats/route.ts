import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildGameStats, parseRange } from "@/lib/game-stats";

/**
 * Estadísticas (estilo SteamDB) del juego de un proveedor. Sin `gameId` devuelve
 * la lista de juegos del proveedor (para poblar el selector). Con `gameId` valida
 * que el juego le pertenezca y devuelve las estadísticas de la ventana pedida.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  if (!provider) return NextResponse.json({ games: [] });

  const games = await prisma.game.findMany({
    where: { providerId: provider.id },
    select: { id: true, title: true, slug: true },
    orderBy: { createdAt: "asc" },
  });

  const { searchParams } = new URL(req.url);
  const gameId = searchParams.get("gameId") || games[0]?.id || "";
  if (!gameId) return NextResponse.json({ games, stats: null });

  // El juego tiene que ser de este proveedor (evita filtrar datos de otros).
  if (!games.some((gm) => gm.id === gameId)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const stats = await buildGameStats(gameId, parseRange(searchParams.get("range")), {
    viewerNpub: session.npub,
  });
  return NextResponse.json({ games, stats });
}
