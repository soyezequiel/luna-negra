import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
