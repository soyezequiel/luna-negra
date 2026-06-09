import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { npubOf, pubkeyFromNpub } from "@/lib/nostr-social";
import { siteUrl } from "@/lib/site-url";
import { queueGameLaunchRequest } from "@/lib/game-launch-requests";

const INVITE_TTL_MS = 3_600_000; // 1h
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Buzón de invitaciones a sala del usuario logueado (first-party, cookie de sesión).
// Lo consulta por polling el NotificationsProvider para mostrar el toast "X te
// invitó". Devolver una invitación la marca como vista (toast una sola vez).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const pending = await prisma.gameInvite.findMany({
    where: { toNpub: session.npub, seenAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      fromNpub: true,
      roomId: true,
      inviteUrl: true,
      createdAt: true,
    },
  });

  if (pending.length) {
    await prisma.gameInvite
      .updateMany({
        where: { id: { in: pending.map((i) => i.id) } },
        data: { seenAt: new Date() },
      })
      .catch(() => {});
  }

  return NextResponse.json({ invites: pending });
}

// Crea una invitacion desde una ventana first-party de Luna Negra. El juego solo
// pasa gameId + roomId; la identidad del host sale de la cookie de sesion.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    gameId?: unknown;
    roomId?: unknown;
    toNpub?: unknown;
  };
  const gameId = typeof body.gameId === "string" ? body.gameId.trim() : "";
  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
  const toPubkey = pubkeyFromNpub(String(body.toNpub ?? ""));
  if (!gameId || !ROOM_RE.test(roomId) || !toPubkey) {
    return NextResponse.json({ error: "Datos invalidos" }, { status: 400 });
  }

  const toNpub = npubOf(toPubkey);
  if (toNpub === session.npub) {
    return NextResponse.json({ error: "No podes invitarte a vos mismo" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      providerId: true,
      slug: true,
      title: true,
      status: true,
      priceSats: true,
    },
  });
  if (!game || game.status !== "published") {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  let owns = game.priceSats === 0;
  if (!owns) {
    const purchase = await prisma.purchase.findUnique({
      where: { userId_gameId: { userId: session.sub, gameId: game.id } },
      select: { status: true },
    });
    owns = purchase?.status === "paid";
  }
  if (!owns) {
    return NextResponse.json({ error: "No tenes acceso a este juego" }, { status: 403 });
  }

  const inviteUrl = `${siteUrl(req)}/game/${game.slug}?room=${encodeURIComponent(roomId)}`;
  await prisma.gameInvite.create({
    data: {
      providerId: game.providerId,
      fromNpub: session.npub,
      toNpub,
      roomId,
      inviteUrl,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  const known = await prisma.user.findUnique({
    where: { npub: toNpub },
    select: { id: true, npub: true, pubkey: true },
  });
  const launchQueued = known
    ? await queueGameLaunchRequest({
        providerId: game.providerId,
        user: known,
        roomId,
        gameId: game.id,
      })
    : false;
  return NextResponse.json({
    ok: true,
    delivered: !!known,
    launchQueued,
    inviteUrl,
    title: game.title,
  });
}
