import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mintRoomInvite } from "@/lib/rooms";

// Crea una sala multijugador: el jugador (host) obtiene un invite token + roomId.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;

  const r = await mintRoomInvite(session, id, null);
  if (!r.ok) {
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
  return NextResponse.json({ token: r.token, roomId: r.roomId, host: r.host, slug: r.slug });
}
