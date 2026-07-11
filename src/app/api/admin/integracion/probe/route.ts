import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { probeGamesNostr } from "@/lib/integration-probe-ngp";
import { persistNgpProbeFindings } from "@/lib/integration-telemetry";

// Probador en vivo de admin: consulta los relays de Nostr para un proveedor
// concreto (?providerId=) y devuelve qué eventos NGP existen (la REST 1.0 fue retirada).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const providerId = new URL(req.url).searchParams.get("providerId")?.trim();
  if (!providerId) {
    return NextResponse.json({ error: "Falta providerId" }, { status: 400 });
  }

  const games = await prisma.game.findMany({
    where: { providerId },
    select: { id: true, nostrCoord: true, nostrEventId: true },
  });
  const nostr = await probeGamesNostr(games);
  // Lo encontrado en relays queda persistido como evidencia ("detectado" fijo).
  persistNgpProbeFindings(providerId, nostr);
  return NextResponse.json({ nostr });
}
