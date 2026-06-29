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
 *
 * FALLBACK POR CLICKS: los proveedores que NO integraron la presencia (§3) no
 * tienen filas en `GamePresence`, así que su curva quedaría siempre vacía. Para
 * esos, estimamos la concurrencia con los clicks en "Jugar" (`GamePlayClick`):
 * cada click marca al jugador como "jugando" por una ventana fija y el sampler
 * cuenta los clicks vigentes. La muestra se marca con `source: "clicks"` para que
 * la UI la presente como estimación. Un proveedor se considera "con presencia
 * integrada" si alguna vez pingeó el endpoint de presencia (`IntegrationPing`
 * feature="presence"); a esos les creemos la presencia real aunque ahora sea 0.
 */

import { prisma } from "@/lib/prisma";

// Cada cuánto tomamos una muestra. Configurable por env; 0 o negativo lo desactiva
// (mismo contrato que los *_INTERVAL_MS de los syncs).
//
// Default 60s: la presencia "jugando" dura ~30s (GamePresence TTL), así que un
// intervalo grande (p. ej. 5 min) PIERDE las sesiones cortas que caen entre dos
// tomas → la curva queda casi vacía aunque el juego reporte presencia. Muestrear
// al minuto captura cualquier sesión de ≥1 min. Es barato: el sampler solo inserta
// fila cuando hay alguien jugando (las tomas vacías no escriben nada).
const DEFAULT_INTERVAL_MS = 60_000;
export const PRESENCE_SAMPLE_INTERVAL_MS = (() => {
  const raw = process.env.PRESENCE_SAMPLE_INTERVAL_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_INTERVAL_MS;
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

  // Presencia real + clicks vigentes + qué proveedores integraron la presencia.
  // Un jugador = un npub distinto con (providerId, npub) único en cada tabla.
  const [presenceRows, clickRows, presenceIntegrations] = await Promise.all([
    prisma.gamePresence.findMany({
      where: { expiresAt: { gt: now } },
      select: { providerId: true, npub: true },
    }),
    prisma.gamePlayClick.findMany({
      where: { expiresAt: { gt: now } },
      select: { providerId: true, npub: true },
    }),
    prisma.integrationPing.findMany({
      where: { feature: "presence" },
      select: { providerId: true },
    }),
  ]);

  // Proveedores que alguna vez reportaron presencia real: a esos les creemos la
  // presencia (aunque ahora sea 0) y NO usamos el fallback por clicks.
  const integrated = new Set(presenceIntegrations.map((p) => p.providerId));

  // npubs reales por proveedor (presencia integrada).
  const realByProvider = new Map<string, Set<string>>();
  for (const r of presenceRows) {
    let set = realByProvider.get(r.providerId);
    if (!set) realByProvider.set(r.providerId, (set = new Set()));
    set.add(r.npub);
  }

  // npubs por clicks por proveedor (dedup por (providerId, npub) igual que la
  // presencia real, aunque GamePlayClick se llavee por (gameId, npub)).
  const clickByProvider = new Map<string, Set<string>>();
  for (const r of clickRows) {
    if (integrated.has(r.providerId)) continue; // tienen presencia real → ignora clicks
    let set = clickByProvider.get(r.providerId);
    if (!set) clickByProvider.set(r.providerId, (set = new Set()));
    set.add(r.npub);
  }

  type SampleRow = {
    providerId: string;
    count: number;
    npubs: string[];
    source: string;
    sampledAt: Date;
  };
  const data: SampleRow[] = [];
  for (const [providerId, set] of realByProvider) {
    data.push({
      providerId,
      count: set.size,
      npubs: [...set].slice(0, MAX_NPUBS_PER_SAMPLE),
      source: "presence",
      sampledAt: now,
    });
  }
  for (const [providerId, set] of clickByProvider) {
    data.push({
      providerId,
      count: set.size,
      npubs: [...set].slice(0, MAX_NPUBS_PER_SAMPLE),
      source: "clicks",
      sampledAt: now,
    });
  }

  if (data.length > 0) {
    await prisma.playerCountSample.createMany({ data });
  }

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60_000);
  await Promise.all([
    prisma.playerCountSample.deleteMany({ where: { sampledAt: { lt: cutoff } } }),
    // Las filas de clicks vencidas ya no cuentan: purgarlas mantiene la tabla chica.
    prisma.gamePlayClick.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
}
