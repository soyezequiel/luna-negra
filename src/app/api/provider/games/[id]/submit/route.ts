import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  const { id } = await params;
  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || !provider || game.providerId !== provider.id) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  if (game.status !== "draft") {
    return NextResponse.json(
      { error: "El juego no está en borrador" },
      { status: 400 },
    );
  }
  const updated = await prisma.game.update({
    where: { id },
    data: { status: "in_review" },
  });
  return NextResponse.json({ game: updated });
}
