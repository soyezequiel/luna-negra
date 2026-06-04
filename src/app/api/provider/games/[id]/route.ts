import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownedGame } from "@/lib/provider";
import { normalizeCategory } from "@/lib/categories";

export async function PATCH(
  req: Request,
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

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim())
    data.title = body.title.trim();
  if (typeof body.description === "string")
    data.description = body.description.trim();
  if (body.category !== undefined)
    data.category = normalizeCategory(body.category);
  if (body.priceSats !== undefined)
    data.priceSats = Math.max(0, Math.floor(Number(body.priceSats) || 0));
  if (typeof body.gameUrl === "string")
    data.gameUrl = body.gameUrl.trim() || null;
  if (typeof body.coverUrl === "string")
    data.coverUrl = body.coverUrl.trim() || null;
  if (Array.isArray(body.screenshots))
    data.screenshots = JSON.stringify(
      body.screenshots.filter((s: unknown) => typeof s === "string"),
    );

  const game = await prisma.game.update({ where: { id }, data });
  return NextResponse.json({ game });
}

export async function DELETE(
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

  const purchases = await prisma.purchase.count({ where: { gameId: id } });
  if (purchases > 0) {
    return NextResponse.json(
      { error: "No se puede borrar: tiene compras. Despublicalo en su lugar." },
      { status: 400 },
    );
  }
  await prisma.review.deleteMany({ where: { gameId: id } });
  await prisma.game.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
