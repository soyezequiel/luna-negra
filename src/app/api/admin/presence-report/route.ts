import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPresenceReport } from "@/lib/presence-report";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  return Boolean(session && isAdmin(session.pubkey));
}

/**
 * Reporte de diagnóstico de presencia "jugando ahora" (admin).
 *   GET /api/admin/presence-report                  → { games } para el selector
 *   GET /api/admin/presence-report?gameId=…         → reporte JSON en pantalla
 *   GET /api/admin/presence-report?gameId=…&download=1 → descarga el JSON
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const gameId = new URL(req.url).searchParams.get("gameId");
  const download = new URL(req.url).searchParams.get("download") === "1";

  // Sin gameId: lista de juegos publicados con coordenada (los únicos con presencia NGP).
  if (!gameId) {
    const games = await prisma.game.findMany({
      where: { status: "published", nostrCoord: { not: null } },
      select: { id: true, slug: true, title: true },
      orderBy: { title: "asc" },
    });
    return NextResponse.json({ games });
  }

  const report = await buildPresenceReport(gameId);
  if ("error" in report) {
    const status = report.error === "GAME_NOT_FOUND" ? 404 : 400;
    return NextResponse.json(report, { status });
  }

  if (download) {
    const stamp = report.serverClock.iso.replace(/[:.]/g, "-");
    const filename = `presencia-${report.game.slug}-${stamp}.json`;
    return new Response(JSON.stringify(report, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json(report);
}
