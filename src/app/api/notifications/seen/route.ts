import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * Avanza la marca "visto hasta" del centro de notificaciones. Acepta un `at`
 * (epoch ms) opcional para marcar como visto solo hasta cierto momento; sin él,
 * marca todo como leído (now). Nunca retrocede la marca.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const at =
    typeof body.at === "number" && Number.isFinite(body.at)
      ? new Date(body.at)
      : new Date();

  const me = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { notificationsSeenAt: true },
  });
  // No retroceder: si la marca ya es más nueva, la dejamos.
  if (me?.notificationsSeenAt && me.notificationsSeenAt >= at) {
    return NextResponse.json({ ok: true, seenAt: me.notificationsSeenAt.getTime() });
  }

  await prisma.user.update({
    where: { id: session.sub },
    data: { notificationsSeenAt: at },
  });
  return NextResponse.json({ ok: true, seenAt: at.getTime() });
}
