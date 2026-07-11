import { prisma } from "./prisma";

/**
 * Tiempo jugado ("12 h en tu registro", "sesión media 8 min"), leído de las
 * filas `PlaySession`. Su escritura provenía del heartbeat de presencia 1.0
 * (retirado con la interfaz REST): estas funciones sirven datos LEGADOS y no se
 * generan filas nuevas. Se conservan para no perder el histórico ya acumulado.
 */

// Tope de sesiones cerradas escaneadas para promediar (defensivo, mismo
// espíritu que MAX_SCAN en leaderboard.ts).
const MAX_SESSIONS_FOR_AVG = 2000;

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
