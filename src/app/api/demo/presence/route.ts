import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { npubOf } from "@/lib/nostr-social";
import { recordPresence } from "@/lib/social";

// Heartbeat de presencia del JUEGO DEMO (public/demo-game). El demo es estático y
// no puede sostener una API key, pero corre en el MISMO origen que Luna Negra, así
// que se autentica con la cookie de sesión del jugador. Reporta presencia bajo el
// provider demo, igual que un proveedor real lo haría con POST /api/v1/presence —
// el demo nunca toca Nostr ni usa window.opener. La tienda deriva el estado NIP-38
// de esta presencia (ver src/lib/playing-presence.ts).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const status =
    (body as { status?: unknown })?.status === "in-game" ? "in-game" : "online";
  const rawRoom = (body as { roomId?: unknown })?.roomId;
  const roomId = typeof rawRoom === "string" && rawRoom ? rawRoom.slice(0, 64) : null;

  // Provider demo sembrado por prisma/seed.mjs ("Estudio Demo").
  const provider = await prisma.provider.findFirst({
    where: { name: "Estudio Demo" },
    select: { id: true },
  });
  if (!provider) {
    return NextResponse.json({ ok: false, error: "no-demo-provider" }, { status: 503 });
  }

  await recordPresence(provider.id, npubOf(session.pubkey), status, roomId);
  return NextResponse.json({ ok: true });
}
