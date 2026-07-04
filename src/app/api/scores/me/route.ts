import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { npubOf } from "@/lib/nostr-social";
import { getPlayerStandings } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/**
 * Puesto del jugador logueado en cada tabla del juego. Alimenta la fila "Vos"
 * de <ScoreLeaderboard>. Sin sesión → sin standings (no es un error, el marcador
 * público sigue andando).
 *   ?gameId=…  → { standings: [{ board, score, rank, total, viaNostr }] }
 */
export async function GET(req: Request) {
  const gameId = new URL(req.url).searchParams.get("gameId");
  if (!gameId) {
    return NextResponse.json({ error: "Falta gameId" }, { status: 400 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ standings: [] });

  try {
    const standings = await getPlayerStandings(gameId, npubOf(session.pubkey));
    return NextResponse.json({ standings });
  } catch {
    return NextResponse.json({ standings: [] });
  }
}
