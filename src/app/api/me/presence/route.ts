import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordStorePresence } from "@/lib/store-presence";

/**
 * Heartbeat de presencia "online en la tienda". Lo llama el beacon del cliente
 * (~30s) mientras la pestaña está abierta y visible. Auth: cookie de sesión (no
 * necesita firmar nada). Renueva la fila `StorePresence` del usuario con TTL
 * corto; el sampler in-process la cuenta para la curva de concurrentes del admin.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  await recordStorePresence(session.pubkey, session.npub);
  return NextResponse.json({ ok: true });
}
