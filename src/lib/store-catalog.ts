import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { categoryQuerySlugs, normalizeCategories } from "@/lib/categories";
import {
  readNgeEvidence,
  scoreGamesByNgp,
  NGP_TOTAL_CAPS,
} from "@/lib/integration-telemetry";
import { getReviewSummary, getReviewSummaries } from "@/lib/reviews";
import { parseScreenshotUrls, parseVideoUrls } from "@/lib/game-media";

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
  // Capturas de pantalla del juego (URLs ya parseadas del JSON). Alimentan la
  // grilla 2×2 del destacado y el popup de la card del catálogo.
  screenshots: string[];
  // Videos (trailers) del juego. El banner del destacado reproduce el primero
  // en hover (mute, sin controles).
  videos: string[];
  createdAt: string; // ISO: ya serializado para el Data Cache
  // Capacidades de Nostr Games Protocol (NGP) que el juego tiene ACTIVAS (0–ngpTotal),
  // con la misma regla que el panel "Capacidades de NGP activas". Es lo que rankea y
  // lo que muestra el sello "NGP N/M" de la card.
  ngpActive: number;
  ngpTotal: number;
  // NGE se considera integrado sólo después de observar un RPC autenticado
  // (una apuesta creada también cuenta como evidencia de RPC).
  ngeIntegrated: boolean;
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
      screenshots: true,
      videos: true,
      createdAt: true,
      manualCaps: true,
      isBeta: true,
    },
  });
  const gameIds = games.map((g) => g.id);
  const [scores, nge, reviews] = await Promise.all([
    scoreGamesByNgp(
      games.map((g) => ({
        id: g.id,
        manualCaps: (g.manualCaps as Record<string, boolean> | null) ?? null,
      })),
    ),
    readNgeEvidence(gameIds),
    getReviewSummaries(gameIds),
  ]);
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
      screenshots: parseScreenshotUrls(g.screenshots),
      videos: parseVideoUrls(g.videos),
      createdAt: g.createdAt.toISOString(),
      ngpActive: scores.get(g.id) ?? 0,
      ngpTotal: NGP_TOTAL_CAPS,
      ngeIntegrated: Boolean(nge.get(g.id)?.rpc),
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
    const [reviews, nge] = await Promise.all([
      getReviewSummary(game.id),
      readNgeEvidence([game.id]),
    ]);
    return {
      ...game,
      categories: normalizeCategories(game.categories),
      reviews,
      ngeIntegrated: Boolean(nge.get(game.id)?.rpc),
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
    const gameIds = games.map((g) => g.id);
    const [reviews, nge] = await Promise.all([
      getReviewSummaries(gameIds),
      readNgeEvidence(gameIds),
    ]);
    return games.map((g) => ({
      ...g,
      reviews: reviews.get(g.id) ?? null,
      ngeIntegrated: Boolean(nge.get(g.id)?.rpc),
    }));
  },
  ["store-related-games"],
  { revalidate: REVALIDATE_SECONDS, tags: [CATALOG_TAG] },
);
