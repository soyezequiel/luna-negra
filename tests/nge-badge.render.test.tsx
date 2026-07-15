import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NgeBadge } from "@/components/game-card";

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
