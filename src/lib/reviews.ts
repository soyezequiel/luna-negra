import { prisma } from "@/lib/prisma";

// Agregado de reseñas para mostrar el resumen estilo Steam ("Muy positivas ·
// 4,6 ★ (87)") en el header de la ficha y en la card del catálogo. Las reseñas
// entran por dos caminos (POST REST 1.0 y review-sync NGP desde Nostr), pero
// ambos escriben la MISMA tabla `Review`, así que el agregado no distingue
// procedencia: total = todo lo publicado, venga de donde venga.

export type ReviewSummary = {
  average: number;
  count: number;
  // null = sin reseñas todavía (no se muestra badge).
  label: string | null;
};

const NO_REVIEWS: ReviewSummary = { average: 0, count: 0, label: null };

/** Etiqueta curada estilo Steam a partir del promedio (con al menos 1 reseña). */
export function reviewLabel(average: number, count: number): string | null {
  if (count === 0) return null;
  if (average >= 4.5) return "Muy positivas";
  if (average >= 3.5) return "Positivas";
  if (average >= 2.5) return "Mixtas";
  return "Negativas";
}

/** Clase de color Tailwind para la etiqueta, compartida entre card y ficha. */
export function reviewLabelClass(label: string): string {
  if (label === "Muy positivas" || label === "Positivas") return "text-ln-aurora-bright";
  if (label === "Mixtas") return "text-ln-corona-bright";
  return "text-ln-danger";
}

/** Resumen de reseñas de UN juego (para la ficha). */
export async function getReviewSummary(gameId: string): Promise<ReviewSummary> {
  const agg = await prisma.review.aggregate({
    where: { gameId },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const count = agg._count._all;
  if (count === 0) return NO_REVIEWS;
  const average = agg._avg.rating ?? 0;
  return { average, count, label: reviewLabel(average, count) };
}

/** Resumen de reseñas de VARIOS juegos de una (para el catálogo/relacionados). */
export async function getReviewSummaries(
  gameIds: string[],
): Promise<Map<string, ReviewSummary>> {
  const out = new Map<string, ReviewSummary>();
  if (gameIds.length === 0) return out;
  const rows = await prisma.review.groupBy({
    by: ["gameId"],
    where: { gameId: { in: gameIds } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  for (const r of rows) {
    const count = r._count._all;
    const average = r._avg.rating ?? 0;
    out.set(r.gameId, { average, count, label: reviewLabel(average, count) });
  }
  return out;
}
