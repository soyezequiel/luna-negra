import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const [games, unannounced] = await Promise.all([
    prisma.game.findMany({
      where: { status: "in_review" },
      include: { provider: true },
      orderBy: { createdAt: "asc" },
    }),
    // Publicados sin anuncio raíz en Nostr (para re-anunciar).
    prisma.game.findMany({
      where: { status: "published", nostrEventId: null },
      include: { provider: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return NextResponse.json({ games, unannounced });
}
