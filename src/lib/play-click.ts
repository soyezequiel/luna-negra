/**
 * Registro de clicks en "Jugar" para los juegos que NO integraron la presencia
 * real (§3, presencia 1.0; su reporte REST fue retirado).
 *
 * Sin heartbeat del game server NO sabemos cuánto dura una sesión, así que NO
 * inventamos esa duración: cada apertura se guarda como un PUNTO discreto en el
 * tiempo (`PlayerCountSample` source="clicks", count=1) que dice "en este instante
 * este jugador abrió el juego", y la pantalla de stats lo dibuja como puntos, no
 * como un bloque continuo (eso sería fabricar concurrencia inexistente).
 *
 * `GamePlayClick` (ventana `PLAY_CLICK_TTL_MS`, upsert por (gameId, npub)) se usa
 * solo para DEDUP: re-abrir/recargar dentro de esa ventana no genera un punto nuevo
 * (no es una apertura nueva), y para el contador "aperturas recientes" del KPI.
 * Para los juegos que SÍ integraron presencia, la curva continua sale de
 * `GamePresence` (no escribimos puntos de clicks). Ver presence-sampler.ts.
 */

import { prisma } from "@/lib/prisma";

// Ventana de dedup tras un click en "Jugar": re-clicks dentro de esta ventana no
// cuentan como una apertura nueva (recargas, re-lanzar). También define el KPI
// "aperturas recientes" (cuántos npubs abrieron en los últimos PLAY_CLICK_TTL_MS).
// Configurable por env; default 10 min.
const DEFAULT_TTL_MS = 10 * 60_000;
export const PLAY_CLICK_TTL_MS = (() => {
  const raw = process.env.PLAY_CLICK_TTL_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
})();

/**
 * Marca el click en "Jugar" de un jugador sobre un juego. Best-effort: nunca debe
 * romper el lanzamiento del juego, así que el llamador lo envuelve en catch.
 *
 * Si es una apertura NUEVA (no hay click vigente del mismo jugador) y el proveedor
 * NO integró la presencia real, guarda un punto discreto de apertura. Idempotente
 * dentro de la ventana por el unique (gameId, npub).
 */
export async function recordPlayClick(
  providerId: string,
  gameId: string,
  npub: string,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLAY_CLICK_TTL_MS);

  // ¿Hay un click vigente de este jugador? Entonces es un re-click dentro de la
  // ventana (recarga / re-lanzar), NO una apertura nueva: solo renueva el TTL.
  const existing = await prisma.gamePlayClick.findUnique({
    where: { gameId_npub: { gameId, npub } },
    select: { expiresAt: true },
  });
  const isNewOpening = !existing || existing.expiresAt <= now;

  await prisma.gamePlayClick.upsert({
    where: { gameId_npub: { gameId, npub } },
    create: { providerId, gameId, npub, expiresAt },
    update: { expiresAt },
  });

  if (!isNewOpening) return;

  // A los proveedores que integraron presencia real NO les escribimos puntos de
  // clicks: su curva continua sale de GamePresence.
  const integrated = await prisma.integrationPing.findFirst({
    where: { providerId, feature: "presence" },
    select: { id: true },
  });
  if (integrated) return;

  // Punto discreto: "en este instante este jugador abrió el juego". No asumimos
  // cuánto duró la sesión (sin heartbeat no se sabe) → es un punto, no un bloque.
  // Guardamos el gameId: las aperturas son por juego (no se mezclan entre juegos
  // del mismo proveedor).
  await prisma.playerCountSample.create({
    data: { providerId, gameId, count: 1, npubs: [npub], source: "clicks", sampledAt: now },
  });
}
