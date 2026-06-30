import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";

/**
 * "Quiénes entran": lista de usuarios ordenada por última actividad (`lastSeen`,
 * que se actualiza en cada login) más un resumen de activos por ventana. Solo
 * admin. No hay historial de logins (guardamos solo el último `lastSeen` por
 * usuario), así que esto es una foto del estado actual, no una serie temporal.
 *
 * El crecimiento (curva de altas) sí es histórico: lo derivamos de `createdAt`.
 */

type Granularity = "day" | "week" | "month";

/** Clave de bucket "YYYY-MM-DD" según la granularidad (semana = lunes; mes = día 1). */
function bucketKey(d: Date, g: Granularity): string {
  const x = new Date(d);
  if (g === "month") {
    x.setUTCDate(1);
  } else if (g === "week") {
    const day = (x.getUTCDay() + 6) % 7; // lunes = 0
    x.setUTCDate(x.getUTCDate() - day);
  }
  return x.toISOString().slice(0, 10);
}

/**
 * Curva de crecimiento: nuevos registros por bucket + total acumulado. La
 * granularidad se elige por el span (día / semana / mes) para no devolver cientos
 * de puntos. Rellena los buckets vacíos para que la línea sea continua.
 */
function buildGrowthSeries(
  dates: Date[],
): { granularity: Granularity; points: { t: string; new: number; total: number }[] } {
  if (dates.length === 0) return { granularity: "day", points: [] };

  const first = dates[0];
  const spanDays = (Date.now() - first.getTime()) / (24 * 60 * 60 * 1000);
  const granularity: Granularity =
    spanDays <= 60 ? "day" : spanDays <= 365 ? "week" : "month";

  const counts = new Map<string, number>();
  for (const d of dates) {
    const k = bucketKey(d, granularity);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  // Recorre desde el primer bucket hasta hoy, paso a paso, rellenando huecos.
  const step = (k: string): string => {
    const x = new Date(`${k}T00:00:00Z`);
    if (granularity === "month") x.setUTCMonth(x.getUTCMonth() + 1);
    else if (granularity === "week") x.setUTCDate(x.getUTCDate() + 7);
    else x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  };

  const end = bucketKey(new Date(), granularity);
  const points: { t: string; new: number; total: number }[] = [];
  let total = 0;
  let cursor = bucketKey(first, granularity);
  // Tope de seguridad por si algo sale raro con las fechas.
  for (let i = 0; i < 5000; i++) {
    const n = counts.get(cursor) ?? 0;
    total += n;
    points.push({ t: cursor, new: n, total });
    if (cursor >= end) break;
    cursor = step(cursor);
  }
  return { granularity, points };
}

// Ventana y bucket de la curva de concurrentes. Mostramos el PICO de usuarios
// online por hora en los últimos 7 días (≤168 puntos): la concurrencia es un
// máximo, no un promedio, así que agregamos por pico.
const CONCURRENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CONCURRENT_BUCKET_MS = 60 * 60 * 1000; // 1 hora

/**
 * Curva de usuarios concurrentes online: pico por bucket horario. Rellena los
 * huecos con 0 para que la línea sea continua desde la primera muestra.
 */
function buildConcurrentSeries(
  samples: { sampledAt: Date; count: number }[],
): { t: string; count: number }[] {
  if (samples.length === 0) return [];
  const peak = new Map<number, number>();
  for (const s of samples) {
    const bucket = Math.floor(s.sampledAt.getTime() / CONCURRENT_BUCKET_MS) * CONCURRENT_BUCKET_MS;
    peak.set(bucket, Math.max(peak.get(bucket) ?? 0, s.count));
  }
  const start = Math.floor(samples[0].sampledAt.getTime() / CONCURRENT_BUCKET_MS) * CONCURRENT_BUCKET_MS;
  const end = Math.floor(Date.now() / CONCURRENT_BUCKET_MS) * CONCURRENT_BUCKET_MS;
  const points: { t: string; count: number }[] = [];
  for (let b = start; b <= end; b += CONCURRENT_BUCKET_MS) {
    points.push({ t: new Date(b).toISOString(), count: peak.get(b) ?? 0 });
  }
  return points;
}

/**
 * Endpoint de "quiénes entran" + crecimiento + concurrentes online. Solo admin.
 */
export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const since1d = new Date(now - DAY);
  const since7d = new Date(now - 7 * DAY);
  const since30d = new Date(now - 30 * DAY);

  const [total, active1d, active7d, active30d, recent, signups] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastSeen: { gte: since1d } } }),
    prisma.user.count({ where: { lastSeen: { gte: since7d } } }),
    prisma.user.count({ where: { lastSeen: { gte: since30d } } }),
    prisma.user.findMany({
      orderBy: { lastSeen: "desc" },
      take: 100,
      select: {
        npub: true,
        displayName: true,
        avatarUrl: true,
        lastSeen: true,
        createdAt: true,
        lastPlayedAt: true,
      },
    }),
    // Todas las fechas de alta (createdAt), para la curva de crecimiento.
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  // Concurrentes online: cuántos hay AHORA (presencia no vencida) + la curva
  // muestreada de los últimos 7 días.
  const [onlineNow, concurrentSamples] = await Promise.all([
    prisma.storePresence.count({ where: { expiresAt: { gt: new Date(now) } } }),
    prisma.storePresenceSample.findMany({
      where: { sampledAt: { gte: new Date(now - CONCURRENT_WINDOW_MS) } },
      orderBy: { sampledAt: "asc" },
      select: { sampledAt: true, count: true },
    }),
  ]);

  const growth = buildGrowthSeries(signups.map((u) => u.createdAt));
  const concurrent = {
    onlineNow,
    peak: concurrentSamples.reduce((m, s) => Math.max(m, s.count), 0),
    points: buildConcurrentSeries(concurrentSamples),
  };

  // Distribución para la gráfica: cuántos entraron en cada ventana (excluyentes)
  // + los inactivos (último login hace más de 30 días).
  const distribution = {
    today: active1d,
    week: active7d - active1d,
    month: active30d - active7d,
    older: total - active30d,
  };

  return NextResponse.json({
    summary: { total, active1d, active7d, active30d },
    concurrent,
    growth,
    distribution,
    visitors: recent.map((u) => ({
      npub: u.npub,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      lastSeen: u.lastSeen.toISOString(),
      createdAt: u.createdAt.toISOString(),
      lastPlayedAt: u.lastPlayedAt ? u.lastPlayedAt.toISOString() : null,
    })),
  });
}
