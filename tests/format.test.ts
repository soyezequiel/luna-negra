import { describe, it, expect } from "vitest";
import { priceLabel, timeAgo } from "@/lib/format";

describe("priceLabel", () => {
  it("muestra Gratis cuando es 0", () => {
    expect(priceLabel(0)).toBe("Gratis");
  });
  it("formatea con sufijo sats", () => {
    expect(priceLabel(1000)).toContain("sats");
  });
});

describe("timeAgo", () => {
  const now = Math.floor(Date.now() / 1000);
  it("momento reciente", () => {
    expect(timeAgo(now)).toBe("hace un momento");
  });
  it("minutos", () => {
    expect(timeAgo(now - 120)).toBe("hace 2 min");
  });
  it("horas", () => {
    expect(timeAgo(now - 3 * 3600)).toBe("hace 3 h");
  });
});
