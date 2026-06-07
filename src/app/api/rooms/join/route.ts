import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { mintRoomInvite } from "@/lib/rooms";

/**
 * Unirse a una sala por **slug** (no por gameId). Lo usan los puntos de entrada
 * de "Unirse" que sólo conocen el link de la sala (`/game/:slug?room=…`): chat,
 * /friends, sidebar y notificaciones. Devuelve además `gameUrl`/`title` para que
 * el cliente lance el juego en una pestaña nueva sin pasar por la página de la
 * tienda.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === "string" ? body.slug : "";
  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  if (!slug || !roomId) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { slug } });
  if (!game || game.status !== "published" || !game.gameUrl) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  const r = await mintRoomInvite(session, game.id, roomId);
  if (!r.ok) {
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
  return NextResponse.json({
    token: r.token,
    roomId: r.roomId,
    host: r.host,
    slug: r.slug,
    title: game.title,
    gameUrl: game.gameUrl,
  });
}
