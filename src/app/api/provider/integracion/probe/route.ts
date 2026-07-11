import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { probeGamesNostr } from "@/lib/integration-probe-ngp";
import { persistNgpProbeFindings } from "@/lib/integration-telemetry";

// Probador en vivo del proveedor logueado: consulta los relays de Nostr y devuelve
// qué eventos NGP existen ahora mismo por juego (la interfaz REST 1.0 fue retirada).
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
    select: { id: true },
  });
  if (!provider) {
    return NextResponse.json({ error: "No tenés un proveedor" }, { status: 404 });
  }

  const games = await prisma.game.findMany({
    where: { providerId: provider.id },
    select: { id: true, nostrCoord: true, nostrEventId: true },
  });
  // Anclas de apuestas v2 por juego (kind:1 real, no el placeholder dev): los
  // recibos de zap de depósito cuelgan de ellas y las prueba probeGamesNostr.
  const zapBets = await prisma.zapBet.findMany({
    where: { providerId: provider.id, anchorEventId: { not: null } },
    select: { gameId: true, anchorEventId: true },
  });
  const anchorsByGame = new Map<string, string[]>();
  for (const b of zapBets) {
    if (!b.anchorEventId || b.anchorEventId.startsWith("dev-anchor-")) continue;
    const list = anchorsByGame.get(b.gameId) ?? [];
    list.push(b.anchorEventId);
    anchorsByGame.set(b.gameId, list);
  }
  const nostr = await probeGamesNostr(
    games.map((g) => ({ ...g, betAnchorIds: anchorsByGame.get(g.id) ?? [] })),
  );
  // Lo encontrado en relays queda persistido como evidencia ("detectado" fijo).
  persistNgpProbeFindings(provider.id, nostr);
  return NextResponse.json({ nostr });
}
