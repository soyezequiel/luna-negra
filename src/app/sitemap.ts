import type { MetadataRoute } from "next";
import { getPublishedCatalog } from "@/lib/store-catalog";
import { SITE_URL } from "@/lib/site";

// Mapa del sitio para los crawlers (Google, njump, etc.). Incluye la home, las
// páginas públicas estáticas y la ficha de cada juego publicado. Las rutas con
// sesión (perfil, biblioteca, mensajes, admin, /api…) quedan fuera a propósito y
// bloqueadas en robots.ts. Reusa el catálogo cacheado, así que no pega a la DB
// en cada visita del bot.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let games: Awaited<ReturnType<typeof getPublishedCatalog>> = [];
  try {
    games = await getPublishedCatalog();
  } catch {
    games = [];
  }

  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    {
      url: `${SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const gamePages: MetadataRoute.Sitemap = games.map((g) => ({
    url: `${SITE_URL}/game/${g.slug}`,
    lastModified: new Date(g.createdAt),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticPages, ...gamePages];
}
