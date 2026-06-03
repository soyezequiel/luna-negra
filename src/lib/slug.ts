import { prisma } from "@/lib/prisma";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // quita diacríticos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Devuelve un slug único para Game (agrega sufijo si hace falta). */
export async function uniqueGameSlug(title: string): Promise<string> {
  const base = slugify(title) || "juego";
  let slug = base;
  for (let i = 0; i < 50; i++) {
    const exists = await prisma.game.findUnique({ where: { slug } });
    if (!exists) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now()}`;
}
