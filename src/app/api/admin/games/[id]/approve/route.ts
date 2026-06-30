import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { syncGameToNostr } from "@/lib/announce-game";
import { revalidateCatalog } from "@/lib/store-catalog";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.game.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  let game = await prisma.game.update({
    where: { id },
    data: { status: "published" },
  });
  // Publica el artículo NIP-23 del juego en Nostr (fuente de verdad) y cachea su
  // identidad en la DB. Best-effort: si falla, el juego queda publicado igual.
  game = await syncGameToNostr(game, req);
  // Refresca el catálogo cacheado (Home + ficha) al instante.
  revalidateCatalog();
  return NextResponse.json({ game });
}
