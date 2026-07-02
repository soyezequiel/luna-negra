/**
 * Presencia "online en la tienda": cuenta a los usuarios que tienen la web de
 * Luna Negra abierta y logueada (distinto de GamePresence, que es "jugando X").
 *
 * El cliente manda un heartbeat (~30s) mientras la pestaña está visible (ver
 * src/components/store-presence-beacon.tsx → POST /api/me/presence). Cada ping
 * renueva la fila `StorePresence` del usuario con un TTL corto, así "offline" es
 * automático al cerrar/dejar la pestaña. El sampler la muestrea para la curva.
 */

import { prisma } from "@/lib/prisma";

// Cuánto vale un heartbeat. >2× del intervalo del cliente (~30s) para tolerar un
// ping perdido sin marcar al usuario offline de más.
export const STORE_PRESENCE_TTL_MS = (() => {
  const raw = process.env.STORE_PRESENCE_TTL_MS;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 75_000;
})();

/** Renueva (o crea) la presencia online del usuario con TTL fresco. */
export async function recordStorePresence(pubkey: string, npub: string): Promise<void> {
  const expiresAt = new Date(Date.now() + STORE_PRESENCE_TTL_MS);
  await prisma.storePresence.upsert({
    where: { pubkey },
    update: { npub, expiresAt },
    create: { pubkey, npub, expiresAt },
  });
}

/**
 * De un conjunto de pubkeys, los que tienen Luna Negra abierta ahora (presencia
 * no vencida). "Conectado" para la lista de amigos = tener la web abierta, esté
 * jugando o no (distinto de la presencia NIP-38 "jugando X").
 */
export async function onlinePubkeys(pubkeys: string[]): Promise<string[]> {
  if (pubkeys.length === 0) return [];
  const rows = await prisma.storePresence.findMany({
    where: { pubkey: { in: pubkeys }, expiresAt: { gt: new Date() } },
    select: { pubkey: true },
  });
  return rows.map((r) => r.pubkey);
}
