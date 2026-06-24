import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  categoryQuerySlugs,
  normalizeCategory,
  normalizeCategories,
  categoryLabel,
} from "@/lib/categories";

describe("normalizeCategory", () => {
  it("acepta un slug válido", () => {
    expect(normalizeCategory("puzzle")).toBe("puzzle");
  });
  it("normaliza mayúsculas y espacios", () => {
    expect(normalizeCategory("  Arcade ")).toBe("arcade");
  });
  it("convierte casino al slug actual timba", () => {
    expect(normalizeCategory("casino")).toBe("timba");
  });
  it("rechaza un slug inexistente", () => {
    expect(normalizeCategory("inventada")).toBeNull();
  });
  it("rechaza valores no-string o vacíos", () => {
    expect(normalizeCategory("")).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory(123)).toBeNull();
  });
});

describe("normalizeCategories", () => {
  it("filtra a slugs válidos y normaliza", () => {
    expect(normalizeCategories(["Puzzle", " arcade ", "Casino"])).toEqual([
      "puzzle",
      "arcade",
      "timba",
    ]);
  });
  it("descarta inválidos y elimina duplicados preservando orden", () => {
    expect(
      normalizeCategories(["accion", "inventada", "accion", "puzzle"]),
    ).toEqual(["accion", "puzzle"]);
  });
  it("devuelve [] para valores no-array o vacíos", () => {
    expect(normalizeCategories(undefined)).toEqual([]);
    expect(normalizeCategories("accion")).toEqual([]);
    expect(normalizeCategories([])).toEqual([]);
    expect(normalizeCategories([123, null, ""])).toEqual([]);
  });
});

describe("categoryLabel", () => {
  it("devuelve el label legible de un slug", () => {
    expect(categoryLabel("estrategia")).toBe("Estrategia");
  });
  it("muestra Timba para el slug heredado casino", () => {
    expect(categoryLabel("casino")).toBe("Timba");
  });
  it("usa 'Sin categoría' cuando no hay slug", () => {
    expect(categoryLabel(null)).toBe("Sin categoría");
    expect(categoryLabel(undefined)).toBe("Sin categoría");
  });
});

describe("categoryQuerySlugs", () => {
  it("incluye aliases heredados para consultar datos viejos", () => {
    expect(categoryQuerySlugs(["timba"])).toEqual(["timba", "casino"]);
  });
});

describe("CATEGORIES", () => {
  it("publica Timba y nuevas categorías curadas", () => {
    expect(CATEGORIES).toEqual(
      expect.arrayContaining([
        { slug: "timba", label: "Timba" },
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
      ]),
    );
    expect(CATEGORIES.some((c) => c.slug === "casino")).toBe(false);
  });
});
