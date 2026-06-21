import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  readIntegrationEvidence,
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

  const games = await prisma.game.findMany({
    where: { providerId: provider.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, slug: true, status: true },
  });
  const [byGame, apiKeys] = await Promise.all([
    readIntegrationEvidence(
      provider.id,
      games.map((g) => g.id),
    ),
    prisma.apiKey.count({ where: { providerId: provider.id, revokedAt: null } }),
  ]);

  const view = buildIntegrationView(
    {
      id: provider.id,
      name: provider.name,
      // Exigimos URL Y secreto: deliver() (lib/webhooks) early-returns sin el
      // secreto, así que una URL sin secreto NO entrega nada — "Configurado" sería
      // engañoso.
      webhookConfigured: !!provider.webhookUrl && !!provider.webhookSecret,
      apiKeys,
    },
    games,
    byGame,
  );
  return NextResponse.json({ view });
}
