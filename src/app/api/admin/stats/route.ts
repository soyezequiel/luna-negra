import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { buildGameStats, parseRange } from "@/lib/game-stats";

/**
 * Estadísticas (estilo SteamDB) de cualquier juego, para admin. Sin `gameId`
 * devuelve el catálogo (proveedores con sus juegos) para poblar los selectores.
 * Con `gameId` devuelve las estadísticas de la ventana pedida.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const providers = await prisma.provider.findMany({
    select: {
      id: true,
      name: true,
      games: {
        select: { id: true, title: true, slug: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  // Solo proveedores con al menos un juego (no hay nada que graficar si no).
  const catalog = providers.filter((p) => p.games.length > 0);

  const { searchParams } = new URL(req.url);
  const gameId = searchParams.get("gameId");
  if (!gameId) return NextResponse.json({ catalog, stats: null });

  const stats = await buildGameStats(gameId, parseRange(searchParams.get("range")), {
    includeHouse: true,
  });
  if (!stats) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ catalog, stats });
}
