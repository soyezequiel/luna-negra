import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { onlinePubkeys } from "@/lib/store-presence";
import { playingPubkeys } from "@/lib/social";

/**
 * "Conectado" para un conjunto de pubkeys: de las que pasás, cuáles el servidor
 * ve activas ahora. Une dos señales durables (ambas de la DB, sin depender de
 * relays):
 *  - `StorePresence`: tienen Luna Negra abierta (heartbeat vigente).
 *  - `GamePresence`: están jugando algún juego (el juego lo reporta por la API),
 *    aunque hayan cerrado la tienda — así se los marca conectados igual.
 * El estado NIP-38 "jugando X" (con el título del juego) es señal aparte que
 * resuelve el cliente contra los relays. Revela sólo el booleano hacia tus
 * contactos, igual que /api/users/known.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const pubkeys: string[] = Array.isArray(body.pubkeys)
    ? body.pubkeys
        .filter((p: unknown) => typeof p === "string" && /^[0-9a-f]{64}$/i.test(p))
        .slice(0, 1000)
    : [];

  if (pubkeys.length === 0) return NextResponse.json({ online: [] });

  const [store, playing] = await Promise.all([
    onlinePubkeys(pubkeys),
    playingPubkeys(pubkeys),
  ]);
  const online = [...new Set([...store, ...playing])];
  return NextResponse.json({ online });
}
