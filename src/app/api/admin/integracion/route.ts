import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import {
  readIntegrationEvidence,
  readNostrEvidence,
  readNgeEvidence,
  buildIntegrationView,
  type IntegrationView,
} from "@/lib/integration-telemetry";

// Vista de integración de TODOS los proveedores (solo admin): telemetría
// observada de cada juego de la plataforma, agrupada por proveedor.
export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const providers = await prisma.provider.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      webhookUrl: true,
      webhookSecret: true,
      _count: { select: { apiKeys: { where: { revokedAt: null } } } },
      games: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          manualCaps: true,
          capsMode: true,
        },
      },
    },
  });

  const views: IntegrationView[] = await Promise.all(
    providers.map(async (p) => {
      const gameIds = p.games.map((g) => g.id);
      const [byGame, nostr, nge] = await Promise.all([
        readIntegrationEvidence(p.id, gameIds),
        readNostrEvidence(gameIds),
        readNgeEvidence(gameIds),
      ]);
      return buildIntegrationView(
        {
          id: p.id,
          name: p.name,
          webhookConfigured: !!p.webhookUrl && !!p.webhookSecret,
          apiKeys: p._count.apiKeys,
        },
        p.games.map((g) => ({
          ...g,
          manualCaps: (g.manualCaps as Record<string, boolean> | null) ?? null,
          capsMode: (g.capsMode as Record<string, string> | null) ?? null,
        })),
        byGame,
        nostr,
        nge,
      );
    }),
  );

  return NextResponse.json({ views });
}
