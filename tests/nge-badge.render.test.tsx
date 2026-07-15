import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BalBadge, NgeBadge } from "@/components/game-card";

describe("NgeBadge", () => {
  it("no promete apuestas si NGE no fue detectado", () => {
    expect(renderToStaticMarkup(<NgeBadge />)).toBe("");
  });

  it("comunica apuestas en sats y el escrow NGE", () => {
    const html = renderToStaticMarkup(<NgeBadge enabled />);

    expect(html).toContain("APOSTÁ SATS");
    expect(html).toContain("NGE ESCROW");
    expect(html).toContain("Apuestas de satoshis disponibles con NGE");
  });
});

describe("BalBadge", () => {
  it("no muestra el sello si el juego no declaró compatibilidad", () => {
    expect(renderToStaticMarkup(<BalBadge />)).toBe("");
  });

  it("identifica los juegos compatibles con Bunker Auto Login", () => {
    const html = renderToStaticMarkup(<BalBadge enabled />);

    expect(html).toContain("BAL");
    expect(html).toContain("AUTO LOGIN");
    expect(html).toContain("Compatible con Bunker Auto Login (BAL)");
  });
});
