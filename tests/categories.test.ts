import { describe, it, expect } from "vitest";
import { normalizeCategory, categoryLabel } from "@/lib/categories";

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

describe("categoryLabel", () => {
  it("devuelve el label legible de un slug", () => {
    expect(categoryLabel("estrategia")).toBe("Estrategia");
  });
  it("usa 'Sin categoría' cuando no hay slug", () => {
    expect(categoryLabel(null)).toBe("Sin categoría");
    expect(categoryLabel(undefined)).toBe("Sin categoría");
  });
});
