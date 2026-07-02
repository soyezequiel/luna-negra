import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordStorePresence, clearStorePresence } from "@/lib/store-presence";

/**
 * Heartbeat de presencia "online en la tienda". Lo llama el beacon del cliente
 * (~30s) mientras la pestaña está abierta y visible. Auth: cookie de sesión (no
 * necesita firmar nada). Renueva la fila `StorePresence` del usuario con TTL
 * corto; el sampler in-process la cuenta para la curva de concurrentes del admin.
 *
 * Con `?offline=1` hace lo contrario: vence la presencia al instante. Lo dispara
 * el beacon de cierre de pestaña (`navigator.sendBeacon`, que solo hace POST) para
 * que el usuario aparezca desconectado casi en vivo, sin arrastrar el TTL ~75s.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const offline = new URL(req.url).searchParams.get("offline") === "1";
  if (offline) {
    await clearStorePresence(session.pubkey);
  } else {
    await recordStorePresence(session.pubkey, session.npub);
  }
  return NextResponse.json({ ok: true });
}
