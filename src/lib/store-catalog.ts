import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { categoryQuerySlugs, normalizeCategories } from "@/lib/categories";
import { scoreGamesByIntegration } from "@/lib/integration-telemetry";
import { getReviewSummary, getReviewSummaries } from "@/lib/reviews";

// Tag único de todo lo que dependa del catálogo publicado (Home + ficha + relacionados).
export const CATALOG_TAG = "games";

/**
 * Invalida el catálogo cacheado. Llamar desde route handlers que cambian lo que la
 * tienda muestra (aprobar, editar, despublicar, borrar). "max" = stale-while-
 * revalidate: sirve lo viejo y refresca en la próxima visita.
 */
export function revalidateCatalog(): void {
  revalidateTag(CATALOG_TAG, "max");
}

// Catálogo publicado cacheado en el Data Cache de Next (persiste entre requests y
// deploys). La portada se renderiza dinámica (lee searchParams), pero las lecturas
// a la DB se sirven de aquí: sin esto cada carga del Home disparaba ~9 queries a
// Neon (findMany + las 8 agregadas de scoreGamesByIntegration), manteniendo el
// compute despierto y quemando la cuota. El catálogo del MVP es chico, así que
// traemos TODO lo publicado una vez y filtramos/rankeamos/paginamos en memoria.
//
// Se invalida al instante con revalidateTag("games") (ver approve de admin); si no,
// caduca solo a los REVALIDATE_SECONDS.

const REVALIDATE_SECONDS = 60;

export type CatalogGame = {
  id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  priceSats: number;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
  createdAt: string; // ISO: ya serializado para el Data Cache
  integration: number; // 0–8 interfaces de Luna Negra cableadas
  isBeta: boolean; // beta: la Home lo filtra salvo opt-in del usuario
  // Resumen de reseñas ("Muy positivas · 4,6 ★ (87)"). label null = sin reseñas.
  reviewLabel: string | null;
  reviewAverage: number;
  reviewCount: number;
};

async function loadCatalog(): Promise<CatalogGame[]> {
  const games = await prisma.game.findMany({
    where: { status: "published" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      providerId: true,
      slug: true,
      title: true,
      description: true,
      categories: true,
      priceSats: true,
      coverUrl: true,
      horizontalCoverUrl: true,
      createdAt: true,
      isBeta: true,
    },
  });
  const scores = await scoreGamesByIntegration(games);
  const reviews = await getReviewSummaries(games.map((g) => g.id));
  return games.map((g) => {
    const r = reviews.get(g.id);
    return {
      id: g.id,
      slug: g.slug,
      title: g.title,
      description: g.description,
      categories: normalizeCategories(g.categories),
      priceSats: g.priceSats,
      coverUrl: g.coverUrl,
      horizontalCoverUrl: g.horizontalCoverUrl,
      createdAt: g.createdAt.toISOString(),
      integration: scores.get(g.id) ?? 0,
      isBeta: g.isBeta,
      reviewLabel: r?.label ?? null,
      reviewAverage: r?.average ?? 0,
      reviewCount: r?.count ?? 0,
    };
  });
}

export const getPublishedCatalog = unstable_cache(loadCatalog, ["store-catalog"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [CATALOG_TAG],
});

// ── Ficha de juego ──────────────────────────────────────────────────────────
// Las lecturas que NO dependen de la sesión (el juego + su proveedor, y los
// relacionados) se cachean por slug/categoría. Para visitas anónimas y bots —los
// que más queman cuota— la ficha queda en 0 queries a Neon. La compra/entitlement
// (purchase.findUnique) es por usuario y se queda fuera de caché en la página.
//
// OJO: unstable_cache serializa con JSON, así que los `Date` (p. ej. createdAt)
// vuelven como string en runtime. Quien los formatee debe envolver con new Date().

export const getPublishedGameBySlug = unstable_cache(
  async (slug: string) => {
    const game = await prisma.game.findUnique({
      where: { slug },
      include: { provider: true },
    });
    if (!game || game.status !== "published") return null;
    const reviews = await getReviewSummary(game.id);
    return {
      ...game,
      categories: normalizeCategories(game.categories),
      reviews,
    };
  },
  ["store-game-by-slug"],
  { revalidate: REVALIDATE_SECONDS, tags: [CATALOG_TAG] },
);

export const getRelatedGames = unstable_cache(
  async (gameId: string, categories: string[]) => {
    const queryCategories = categoryQuerySlugs(categories);
    const games = await prisma.game.findMany({
      where: {
        status: "published",
        id: { not: gameId },
        ...(queryCategories.length > 0
          ? { categories: { hasSome: queryCategories } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 4,
    });
    const reviews = await getReviewSummaries(games.map((g) => g.id));
    return games.map((g) => ({ ...g, reviews: reviews.get(g.id) ?? null }));
  },
  ["store-related-games"],
  { revalidate: REVALIDATE_SECONDS, tags: [CATALOG_TAG] },
);
