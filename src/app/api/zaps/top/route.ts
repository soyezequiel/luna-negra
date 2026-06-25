import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Top de zappers, derivado de los recibos 9735 verificados que guarda la
 * reconciliación (zap-sync.ts) en la tabla `Zap`. Público (no expone montos por
 * persona que no sean ya públicos en Nostr). Filtrá por:
 *   ?gameId=…     → top de un juego
 *   ?providerId=… → top acumulado de un dev (todos sus juegos)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const gameId = url.searchParams.get("gameId");
  const providerId = url.searchParams.get("providerId");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || 10, 1),
    50,
  );

  if (!gameId && !providerId) {
    return NextResponse.json(
      { error: "Falta gameId o providerId" },
      { status: 400 },
    );
  }

  const where = gameId ? { gameId } : { providerId: providerId! };

  try {
    const rows = await prisma.zap.groupBy({
      by: ["zapperPubkey"],
      where,
      _sum: { amountSats: true },
      _count: { _all: true },
      orderBy: { _sum: { amountSats: "desc" } },
      take: limit,
    });
    const entries = rows.map((r) => ({
      pubkey: r.zapperPubkey,
      totalSats: r._sum.amountSats ?? 0,
      count: r._count._all,
    }));
    return NextResponse.json({ entries });
  } catch {
    // DB fría (Neon P1002) o indisponible: el top es no crítico, devolvemos vacío.
    return NextResponse.json({ entries: [] });
  }
}
