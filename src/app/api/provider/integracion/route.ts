import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  readProviderPings,
  buildIntegrationView,
} from "@/lib/integration-telemetry";

// Vista de integración del proveedor logueado: telemetría observada (qué
// interfaces de Luna Negra usa cada uno de sus juegos y cuándo por última vez).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  if (!provider) {
    return NextResponse.json({ view: null });
  }

  const [games, byGame, apiKeys] = await Promise.all([
    prisma.game.findMany({
      where: { providerId: provider.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, slug: true, status: true },
    }),
    readProviderPings(provider.id),
    prisma.apiKey.count({ where: { providerId: provider.id, revokedAt: null } }),
  ]);

  const view = buildIntegrationView(
    {
      id: provider.id,
      name: provider.name,
      webhookConfigured: !!provider.webhookUrl,
      apiKeys,
    },
    games,
    byGame,
  );
  return NextResponse.json({ view });
}
