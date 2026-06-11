import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, signEntitlement, signBetSession } from "@/lib/auth";

// Crea una "sesión de juego": mintea el token de acceso (entitlement) para lanzar
// el juego, si el jugador lo posee (o es gratis).
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

  // Marca "jugó alguna vez / última vez" (ordena la lista de amigos).
  await prisma.user
    .update({ where: { id: session.sub }, data: { lastPlayedAt: new Date() } })
    .catch(() => {});

  const token = await signEntitlement({
    npub: session.npub,
    pubkey: session.pubkey,
    gameId: id,
    slug: game.slug,
  });
  // Token de mínimo privilegio para que el modal de apuestas opere como el jugador.
  const betSession = await signBetSession({
    sub: session.sub,
    npub: session.npub,
    pubkey: session.pubkey,
  });
  return NextResponse.json({ token, betSession });
}
