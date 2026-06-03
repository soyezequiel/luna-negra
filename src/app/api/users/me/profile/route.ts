import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Cachea el perfil Nostr (kind:0) del usuario en la DB, para mostrar nombre/avatar
// sin tener que consultar relays en cada render del lado servidor.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim().slice(0, 80)
      : null;
  const avatarUrl =
    typeof body.avatarUrl === "string" && body.avatarUrl.trim()
      ? body.avatarUrl.trim().slice(0, 500)
      : null;

  await prisma.user.update({
    where: { id: session.sub },
    data: { displayName, avatarUrl },
  });
  return NextResponse.json({ ok: true });
}
