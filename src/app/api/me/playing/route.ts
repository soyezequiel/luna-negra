import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { npubOf } from "@/lib/nostr-social";
import { getOwnPresence } from "@/lib/social";

// Presencia del PROPIO jugador (¿está jugando algo ahora?). La tienda la sondea
// para gobernar su estado NIP-38 "Jugando X" (ver src/lib/playing-presence.ts).
// Auth por cookie de sesión (consumo interno del frontend, NO la API v1 con API
// key). Normalizamos el npub desde el pubkey para casar con cómo lo guarda
// `recordPresence` (npubOf(pubkey)).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ playing: false }, { status: 401 });
  }
  const presence = await getOwnPresence(npubOf(session.pubkey));
  return NextResponse.json({
    playing: Boolean(presence),
    status: presence?.status ?? null,
    roomId: presence?.roomId ?? null,
  });
}
