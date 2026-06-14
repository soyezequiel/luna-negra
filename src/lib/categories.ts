// Categorías curadas de la tienda. Lista fija en código (no en DB): se usa para
// validar al guardar un juego y para renderizar los filtros del catálogo.

export type Category = { slug: string; label: string };

export const CATEGORIES: Category[] = [
  { slug: "accion", label: "Acción" },
  { slug: "aventura", label: "Aventura" },
  { slug: "puzzle", label: "Puzzle" },
  { slug: "estrategia", label: "Estrategia" },
  { slug: "arcade", label: "Arcade" },
  { slug: "casino", label: "Casino" },
  { slug: "multijugador", label: "Multijugador" },
  { slug: "otros", label: "Otros" },
];

const SLUGS = new Set(CATEGORIES.map((c) => c.slug));

/** Devuelve el slug si es una categoría válida, o null. */
export function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return SLUGS.has(v) ? v : null;
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

/** Label legible para un slug (o "Sin categoría" si no hay/no existe). */
export function categoryLabel(slug: string | null | undefined): string {
  if (!slug) return "Sin categoría";
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}
