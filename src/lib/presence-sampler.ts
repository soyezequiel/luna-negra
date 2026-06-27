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

/**
 * Toma una muestra: cuenta jugadores con presencia activa (no vencida) agrupados
 * por proveedor e inserta una fila por proveedor con al menos un jugador. Los
 * proveedores sin jugadores no generan fila (hueco = 0 al graficar). Después purga
 * muestras más viejas que la retención.
 */
export async function samplePresence(): Promise<void> {
  const now = new Date();

  // Un jugador = un npub distinto con presencia vigente. `GamePresence` ya tiene
  // unique (providerId, npub), así que contar filas activas equivale a contar
  // jugadores distintos por proveedor.
  const groups = await prisma.gamePresence.groupBy({
    by: ["providerId"],
    where: { expiresAt: { gt: now } },
    _count: { _all: true },
  });

  if (groups.length > 0) {
    await prisma.playerCountSample.createMany({
      data: groups.map((g) => ({
        providerId: g.providerId,
        count: g._count._all,
        sampledAt: now,
      })),
    });
  }

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60_000);
  await prisma.playerCountSample.deleteMany({
    where: { sampledAt: { lt: cutoff } },
  });
}
