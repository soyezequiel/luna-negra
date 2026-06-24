// Categorías curadas de la tienda. Lista fija en código (no en DB): se usa para
// validar al guardar un juego y para renderizar los filtros del catálogo.

export type Category = { slug: string; label: string };

export const CATEGORIES: Category[] = [
  { slug: "accion", label: "Acción" },
  { slug: "aventura", label: "Aventura" },
  { slug: "puzzle", label: "Puzzle" },
  { slug: "estrategia", label: "Estrategia" },
  { slug: "arcade", label: "Arcade" },
  { slug: "timba", label: "Timba" },
  { slug: "multijugador", label: "Multijugador" },
  { slug: "rol", label: "Rol" },
  { slug: "deportes", label: "Deportes" },
  { slug: "carreras", label: "Carreras" },
  { slug: "simulacion", label: "Simulación" },
  { slug: "terror", label: "Terror" },
  { slug: "plataformas", label: "Plataformas" },
  { slug: "supervivencia", label: "Supervivencia" },
  { slug: "shooter", label: "Shooter" },
  { slug: "cartas", label: "Cartas" },
  { slug: "ritmo", label: "Ritmo" },
  { slug: "otros", label: "Otros" },
];

const CATEGORY_ALIASES: Record<string, string> = {
  casino: "timba",
};

const SLUGS = new Set(CATEGORIES.map((c) => c.slug));

/** Devuelve el slug si es una categoría válida, o null. */
export function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const slug = CATEGORY_ALIASES[v] ?? v;
  return SLUGS.has(slug) ? slug : null;
}

/**
 * Normaliza una lista de categorías: filtra a slugs válidos, sin duplicados y
 * preservando el orden de aparición. Acepta cualquier valor (típicamente el body
 * de la API) y devuelve siempre un array (vacío si nada es válido).
 */
export function normalizeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const slug = normalizeCategory(item);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/** Slugs canónicos + aliases heredados para consultas contra datos no migrados. */
export function categoryQuerySlugs(value: unknown): string[] {
  const canonical = normalizeCategories(value);
  const out = [...canonical];
  for (const [legacy, replacement] of Object.entries(CATEGORY_ALIASES)) {
    if (canonical.includes(replacement) && !out.includes(legacy)) {
      out.push(legacy);
    }
  }
  return out;
}

/** Label legible para un slug (o "Sin categoría" si no hay/no existe). */
export function categoryLabel(slug: string | null | undefined): string {
  if (!slug) return "Sin categoría";
  const normalized = normalizeCategory(slug);
  return CATEGORIES.find((c) => c.slug === normalized)?.label ?? slug;
}
