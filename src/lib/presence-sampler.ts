/**
 * Muestreo de presencia para la curva "jugadores concurrentes en el tiempo"
 * (estilo SteamDB). La presencia (`GamePresence`) es efímera (TTL ~30s, sin
 * histórico): para poder dibujar una serie temporal, cada pocos minutos contamos
 * cuántos jugadores tienen presencia ACTIVA por proveedor y guardamos una fila en
 * `PlayerCountSample`. Lo dispara el tick in-process (ver src/instrumentation.ts),
 * mismo patrón que zap/comment/game/score-sync.
 *
 * OJO: `GamePresence` se llavea por (providerId, npub) — no tiene gameId —, así
 * que el conteo es POR PROVEEDOR. La serie arranca vacía y crece de aquí en más.
 */

import { prisma } from "@/lib/prisma";

// Cada cuánto tomamos una muestra. Configurable por env; default 5 min. 0 o
// negativo lo desactiva (mismo contrato que los *_INTERVAL_MS de los syncs).
export const PRESENCE_SAMPLE_INTERVAL_MS = (() => {
  const raw = process.env.PRESENCE_SAMPLE_INTERVAL_MS;
  if (raw == null || raw.trim() === "") return 5 * 60_000;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 5 * 60_000;
})();

// Cuánto histórico conservamos. Las muestras viejas se purgan en cada corrida
// para que la tabla no crezca sin límite. Default 90 días.
const RETENTION_DAYS = (() => {
  const raw = process.env.PRESENCE_SAMPLE_RETENTION_DAYS;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 90;
})();

// Tope de npubs guardados por muestra: evita que una muestra con mucha gente
// haga crecer la fila sin límite. El `count` es siempre el real; la lista de
// npubs se trunca (sirve para "quién jugaba", no como fuente de conteo).
const MAX_NPUBS_PER_SAMPLE = 200;

/**
 * Toma una muestra: junta los npubs con presencia activa (no vencida) por
 * proveedor e inserta una fila por proveedor con al menos un jugador, guardando
 * el conteo real + la lista de npubs (para mostrar QUIÉN jugaba). Los proveedores
 * sin jugadores no generan fila (hueco = 0 al graficar). Después purga muestras
 * más viejas que la retención.
 */
export async function samplePresence(): Promise<void> {
  const now = new Date();

  // Un jugador = un npub distinto con presencia vigente. `GamePresence` ya tiene
  // unique (providerId, npub), así que cada fila activa es un jugador distinto.
  const rows = await prisma.gamePresence.findMany({
    where: { expiresAt: { gt: now } },
    select: { providerId: true, npub: true },
  });

  const byProvider = new Map<string, string[]>();
  for (const r of rows) {
    const list = byProvider.get(r.providerId);
    if (list) list.push(r.npub);
    else byProvider.set(r.providerId, [r.npub]);
  }

  if (byProvider.size > 0) {
    await prisma.playerCountSample.createMany({
      data: [...byProvider.entries()].map(([providerId, npubs]) => ({
        providerId,
        count: npubs.length,
        npubs: npubs.slice(0, MAX_NPUBS_PER_SAMPLE),
        sampledAt: now,
      })),
    });
  }

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60_000);
  await prisma.playerCountSample.deleteMany({
    where: { sampledAt: { lt: cutoff } },
  });
}
