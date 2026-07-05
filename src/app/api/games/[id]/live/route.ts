import { NextResponse } from "next/server";
import { getLiveNow, getPeakToday } from "@/lib/live-presence";

export const dynamic = "force-dynamic";

/**
 * Jugadores en vivo de un juego, estilo SteamDB ("142 jugando ahora · pico hoy
 * 380"). Público: no expone quién, solo el conteo. Unifica presencia 1.0
 * (GamePresence, REST) y NGP (NIP-38, ver live-presence.ts).
 *   → { now, peakToday }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params;
  try {
    const [now, peakToday] = await Promise.all([
      getLiveNow(gameId),
      getPeakToday(gameId),
    ]);
    return NextResponse.json({ now, peakToday });
  } catch {
    // Presencia es no crítica: si la DB no responde, mostramos "sin datos".
    return NextResponse.json({ now: 0, peakToday: 0 });
  }
}
