import { NextResponse, type NextRequest } from "next/server";
import { nip19 } from "nostr-tools";
import { isAdmin } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPresenceReport } from "@/lib/presence-report";

/** Resuelve un pubkey hex desde un `?pubkey=` (hex) o `?npub=` (bech32). */
function resolvePubkey(params: URLSearchParams): string | undefined {
  const hex = params.get("pubkey");
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) return hex.toLowerCase();
  const npub = params.get("npub");
  if (npub) {
    try {
      const dec = nip19.decode(npub);
      if (dec.type === "npub") return dec.data;
    } catch {
      /* npub inválido: se ignora */
    }
  }
  return undefined;
}

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

  const params = new URL(req.url).searchParams;
  const gameId = params.get("gameId");
  const download = params.get("download") === "1";
  const pubkey = resolvePubkey(params);

  // Sin gameId: lista de juegos publicados con coordenada (los únicos con presencia NGP).
  if (!gameId) {
    const games = await prisma.game.findMany({
      where: { status: "published", nostrCoord: { not: null } },
      select: { id: true, slug: true, title: true },
      orderBy: { title: "asc" },
    });
    return NextResponse.json({ games });
  }

  const report = await buildPresenceReport(gameId, { pubkey });
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
