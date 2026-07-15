import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scoreGamesByNgp, NGP_TOTAL_CAPS } from "@/lib/integration-telemetry";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const purchases = await prisma.purchase.findMany({
    where: { userId: session.sub, status: "paid" },
    include: { game: true },
    orderBy: { paidAt: "desc" },
  });

  // Capacidades NGP activas por juego, igual que la tienda (sello "NGP N/M").
  const ngp = await scoreGamesByNgp(
    purchases.map((p) => ({
      id: p.game.id,
      manualCaps: (p.game.manualCaps as Record<string, boolean> | null) ?? null,
    })),
  );

  return NextResponse.json({
    games: purchases.map((p) => ({
      id: p.game.id,
      slug: p.game.slug,
      title: p.game.title,
      coverUrl: p.game.coverUrl,
      gameUrl: p.game.gameUrl,
      balCompatible: !!(
        p.game.manualCaps as Record<string, boolean> | null
      )?.bal,
      // Solo los entitlements gratuitos se pueden quitar de la biblioteca (un
      // juego pagado con sats no, para no perder el acceso comprado).
      free: p.amountSats === 0,
      ngpActive: ngp.get(p.game.id) ?? 0,
      ngpTotal: NGP_TOTAL_CAPS,
    })),
  });
}
