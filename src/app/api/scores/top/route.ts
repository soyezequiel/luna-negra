import { NextResponse } from "next/server";
import { readGameLeaderboards } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/**
 * Marcadores de un juego para su página en la tienda. Alimenta el componente
 * <ScoreLeaderboard>. Sale del read-model `Score`, que reciben tanto la API REST
 * 1.0 como el sync NGP (kind:31339) — mismo ranking, sin importar el camino.
 *
 * Público: los puntajes ya son públicos (firmados en Nostr o subidos por el juego).
 * ⚠️ Son FALSIFICABLES (los manda el cliente): sirven para mostrar, no para dinero.
 *   ?gameId=…  → { boards: [{ name, entries: [{ npub, score, rank, viaNostr }] }] }
 */
export async function GET(req: Request) {
  const gameId = new URL(req.url).searchParams.get("gameId");
  if (!gameId) {
    return NextResponse.json({ error: "Falta gameId" }, { status: 400 });
  }
  try {
    const boards = await readGameLeaderboards(gameId);
    return NextResponse.json({ boards });
  } catch {
    // DB fría/indisponible: el marcador es no crítico, devolvemos vacío.
    return NextResponse.json({ boards: [] });
  }
}
