import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, signEntitlement } from "@/lib/auth";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || game.status !== "published") {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  let owns = game.priceSats === 0;
  if (!owns) {
    const p = await prisma.purchase.findUnique({
      where: { userId_gameId: { userId: session.sub, gameId: id } },
    });
    owns = p?.status === "paid";
  }
  if (!owns) {
    return NextResponse.json(
      { error: "No tenés acceso a este juego" },
      { status: 403 },
    );
  }

  const token = await signEntitlement({
    npub: session.npub,
    pubkey: session.pubkey,
    gameId: id,
    slug: game.slug,
  });
  return NextResponse.json({ token });
}
