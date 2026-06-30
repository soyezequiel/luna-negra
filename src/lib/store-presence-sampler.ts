/**
 * Muestreo de la presencia online de la tienda para la curva "usuarios
 * concurrentes en el tiempo" (estilo SteamDB) del admin. `StorePresence` es
 * efímera (TTL ~75s, sin histórico): cada minuto contamos cuántos usuarios
 * distintos siguen online y guardamos una fila en `StorePresenceSample`. Lo
 * dispara el tick in-process (instrumentation.ts), mismo patrón que el sampler de
 * presencia de juegos (presence-sampler.ts) y los demás syncs.
 *
 * La serie arranca vacía y crece de aquí en más (no hay forma de reconstruir
 * concurrencia pasada: antes no guardábamos heartbeats de "navegando").
 */

import { prisma } from "@/lib/prisma";

// Cada cuánto tomamos una muestra. Configurable por env; 0 o negativo lo desactiva.
const DEFAULT_INTERVAL_MS = 60_000;
export const STORE_PRESENCE_SAMPLE_INTERVAL_MS = (() => {
  const raw = process.env.STORE_PRESENCE_SAMPLE_INTERVAL_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_INTERVAL_MS;
})();

// Cuánto histórico conservamos. Las muestras viejas se purgan en cada corrida.
const RETENTION_DAYS = (() => {
  const raw = process.env.STORE_PRESENCE_SAMPLE_RETENTION_DAYS;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 90;
})();

// Tope de npubs guardados por muestra (el `count` es siempre el real; la lista
// solo sirve para "quién estaba online").
const MAX_NPUBS_PER_SAMPLE = 200;

/**
 * Toma una muestra: cuenta los usuarios con presencia online no vencida y, si hay
 * al menos uno, inserta una fila con el conteo + la lista de npubs. Después purga
 * muestras más viejas que la retención y las filas de presencia ya vencidas.
 */
export async function sampleStorePresence(): Promise<void> {
  const now = new Date();

  const online = await prisma.storePresence.findMany({
    where: { expiresAt: { gt: now } },
    select: { npub: true },
  });

  if (online.length > 0) {
    const npubs = [...new Set(online.map((r) => r.npub))];
    await prisma.storePresenceSample.create({
      data: {
        count: npubs.length,
        npubs: npubs.slice(0, MAX_NPUBS_PER_SAMPLE),
        sampledAt: now,
      },
    });
  }

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60_000);
  await Promise.all([
    prisma.storePresenceSample.deleteMany({ where: { sampledAt: { lt: cutoff } } }),
    prisma.storePresence.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
}
