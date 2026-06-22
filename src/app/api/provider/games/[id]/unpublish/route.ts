import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownedGame } from "@/lib/provider";
import { revalidateCatalog } from "@/lib/store-catalog";

// Vuelve el juego a borrador (lo saca de la tienda / de revisión).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await ownedGame(session, id);
  if (!owned) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  const game = await prisma.game.update({
    where: { id },
    data: { status: "draft" },
  });
  revalidateCatalog();
  return NextResponse.json({ game });
}
