import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, signInvite } from "@/lib/auth";

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Mintea un token de invitación a una sala multijugador.
 * - Sin `roomId` en el body → el jugador es **host**, se genera una sala nueva.
 * - Con `roomId` → el jugador **se une** a una sala existente.
 * Solo si posee el juego (o es gratis), igual que play-token.
 */
export async function POST(
  req: Request,
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

  const body = await req.json().catch(() => ({}));
  const joining = typeof body.roomId === "string" && body.roomId.trim();
  let roomId: string;
  if (joining) {
    roomId = body.roomId.trim();
    if (!ROOM_RE.test(roomId)) {
      return NextResponse.json({ error: "Sala inválida" }, { status: 400 });
    }
  } else {
    roomId = crypto.randomUUID().slice(0, 8);
  }
  const host = !joining;

  const token = await signInvite({
    npub: session.npub,
    pubkey: session.pubkey,
    gameId: id,
    slug: game.slug,
    roomId,
    host,
  });
  return NextResponse.json({ token, roomId, host, slug: game.slug });
}
