import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";

// Rechaza un juego en revisión → vuelve a borrador para que el proveedor lo edite.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const game = await prisma.game.update({
    where: { id },
    data: { status: "draft" },
  });
  return NextResponse.json({ game });
}
