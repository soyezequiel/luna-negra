import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * Descarta una notificación ("marcar leído y que se vaya"). Guarda su clave
 * estable (NotifItem.id) para filtrarla del feed derivado. Idempotente: volver a
 * descartar la misma clave no falla.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const key = typeof body.id === "string" ? body.id.slice(0, 200) : "";
  if (!key) {
    return NextResponse.json({ error: "Falta el id" }, { status: 400 });
  }

  await prisma.dismissedNotification.upsert({
    where: { userId_key: { userId: session.sub, key } },
    update: {},
    create: { userId: session.sub, key },
  });
  return NextResponse.json({ ok: true });
}
