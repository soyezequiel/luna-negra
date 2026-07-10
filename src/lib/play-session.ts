import { prisma } from "./prisma";

/**
 * Tiempo jugado ("12 h en tu registro", "sesión media 8 min"), derivado del
 * heartbeat de presencia 1.0 (retirado con la interfaz REST; datos legados). Cada
 * latido extiende la racha abierta o abre una nueva; cuando pasan más de
 * `SESSION_GAP_MS` sin latidos, la racha se considera cerrada y se cierra con
 * su ÚLTIMO latido real (no con el momento en que se detecta el cierre), para
 * no sobrestimar sesiones que quedaron con la pestaña abierta sin jugar.
 *
 * Solo mide juegos con presencia real integrada: los que solo reportan clicks
 * en "Jugar" (§3 no integrado) no generan filas acá — sin heartbeat no hay
 * forma de saber cuánto duró la sesión sin inventarla (mismo criterio que
 * `PlayerCountSample.source="clicks"`, ver play-click.ts).
 */

// Más que el TTL de presencia (~30s, PRESENCE_TTL_MS en social.ts) para no
// cortar una sesión por un latido perdido aislado.
const SESSION_GAP_MS = 45_000;

// Tope de sesiones cerradas escaneadas para promediar (defensivo, mismo
// espíritu que MAX_SCAN en leaderboard.ts).
const MAX_SESSIONS_FOR_AVG = 2000;

/**
 * Registra un latido como parte de una sesión de juego. Alimentaba el heartbeat
 * de presencia 1.0 (`recordPresence`), retirado con la interfaz REST.
 */
export async function touchPlaySession(
  providerId: string,
  gameId: string | null,
  npub: string,
): Promise<void> {
  const now = new Date();
  const open = await prisma.playSession.findFirst({
    where: { providerId, gameId, npub, endedAt: null },
    orderBy: { lastBeatAt: "desc" },
  });

  if (open && now.getTime() - open.lastBeatAt.getTime() <= SESSION_GAP_MS) {
    await prisma.playSession.update({
      where: { id: open.id },
      data: { lastBeatAt: now },
    });
    return;
  }

  if (open) {
    // Racha vieja que no se cerró a tiempo (el sweeper corre cada minuto):
    // cerrarla con su último latido real, no con "ahora".
    await prisma.playSession.update({
      where: { id: open.id },
      data: { endedAt: open.lastBeatAt },
    });
  }

  await prisma.playSession.create({
    data: { providerId, gameId, npub, startedAt: now, lastBeatAt: now },
  });
}

/**
 * Cierra sesiones abandonadas (el jugador no volvió a latir nunca más, o el
 * servidor se reinició sin verlo). Llamarlo periódicamente (ver
 * presence-sampler.ts, que ya purga GamePresence/GamePlayClick en el mismo tick).
 */
export async function closeStalePlaySessions(): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_GAP_MS);
  await prisma.$executeRaw`
    UPDATE "PlaySession" SET "endedAt" = "lastBeatAt"
    WHERE "endedAt" IS NULL AND "lastBeatAt" < ${cutoff}
  `;
}

/**
 * Tiempo total jugado por un jugador en un juego (ms), sumando sesiones
 * cerradas + la abierta (si hay) hasta su último latido conocido — no hasta
 * "ahora", para no inflar el total entre dos heartbeats.
 */
export async function getUserPlaytimeMs(
  gameId: string,
  npub: string,
): Promise<number> {
  const rows = await prisma.playSession.findMany({
    where: { gameId, npub },
    select: { startedAt: true, endedAt: true, lastBeatAt: true },
  });
  let total = 0;
  for (const r of rows) {
    const end = (r.endedAt ?? r.lastBeatAt).getTime();
    total += Math.max(0, end - r.startedAt.getTime());
  }
  return total;
}

/** Duración media de sesión (ms) de un juego, sobre las últimas sesiones cerradas. */
export async function getAvgSessionMs(gameId: string): Promise<number | null> {
  const rows = await prisma.playSession.findMany({
    where: { gameId, endedAt: { not: null } },
    orderBy: { endedAt: "desc" },
    take: MAX_SESSIONS_FOR_AVG,
    select: { startedAt: true, endedAt: true },
  });
  if (rows.length === 0) return null;
  const total = rows.reduce(
    (s, r) => s + (r.endedAt!.getTime() - r.startedAt.getTime()),
    0,
  );
  return total / rows.length;
}
