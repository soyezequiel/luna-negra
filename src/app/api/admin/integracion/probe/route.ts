import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { runProbe } from "@/lib/integration-probe";
import { probeGamesNostr } from "@/lib/integration-probe-ngp";
import { siteUrl } from "@/lib/site-url";

// Probador en vivo de admin: corre la suite de health-check contra los endpoints
// del contrato público, en nombre de un proveedor concreto (?providerId=).
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
  const [results, nostr] = await Promise.all([
    runProbe({ providerId, origin: siteUrl(req) }),
    probeGamesNostr(games),
  ]);
  return NextResponse.json({ results, nostr });
}
