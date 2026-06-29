/**
 * Registro de clicks en "Jugar" para estimar jugadores concurrentes en juegos que
 * NO integraron la presencia real (§3, POST /api/v1/presence).
 *
 * Sin heartbeat del game server no hay forma de saber cuánto dura una sesión. Al
 * hacer click en "Jugar" marcamos al jugador como "jugando" durante una ventana
 * fija (`PLAY_CLICK_TTL_MS`); los re-clicks dentro de esa ventana solo la renuevan
 * (upsert por (gameId, npub)) — así un mismo usuario no se cuenta varias veces en
 * un período corto. El sampler (presence-sampler.ts) cuenta los clicks vigentes
 * SOLO para proveedores sin presencia integrada. Ver modelo GamePlayClick.
 */

import { prisma } from "@/lib/prisma";

// Ventana de sesión asumida tras un click en "Jugar". Es a la vez la duración que
// asumimos que el jugador sigue jugando (para la curva de concurrentes) y el
// período de dedup (re-clicks dentro de la ventana no suman). Configurable por env;
// default 10 min: suficiente para no contar dos veces al mismo jugador, sin inflar
// demasiado la concurrencia estimada.
const DEFAULT_TTL_MS = 10 * 60_000;
export const PLAY_CLICK_TTL_MS = (() => {
  const raw = process.env.PLAY_CLICK_TTL_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
})();

/**
 * Marca (o renueva) el click en "Jugar" de un jugador sobre un juego. Best-effort:
 * nunca debe romper el lanzamiento del juego, así que el llamador lo envuelve en
 * catch. Idempotente dentro de la ventana por el unique (gameId, npub).
 */
export async function recordPlayClick(
  providerId: string,
  gameId: string,
  npub: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + PLAY_CLICK_TTL_MS);
  await prisma.gamePlayClick.upsert({
    where: { gameId_npub: { gameId, npub } },
    create: { providerId, gameId, npub, expiresAt },
    update: { expiresAt },
  });
}
