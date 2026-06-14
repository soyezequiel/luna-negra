import { describe, it, expect } from "vitest";
import {
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
    expect(normalizeCategories(["Puzzle", " arcade "])).toEqual([
      "puzzle",
      "arcade",
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
  it("usa 'Sin categoría' cuando no hay slug", () => {
    expect(categoryLabel(null)).toBe("Sin categoría");
    expect(categoryLabel(undefined)).toBe("Sin categoría");
  });
});
