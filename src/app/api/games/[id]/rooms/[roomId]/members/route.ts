import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mintRoomInvite } from "@/lib/rooms";

// Unirse a una sala existente: el jugador obtiene su propio invite token (host:false).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id, roomId } = await params;

  const r = await mintRoomInvite(session, id, roomId);
  if (!r.ok) {
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
  return NextResponse.json({ token: r.token, roomId: r.roomId, host: r.host, slug: r.slug });
}
