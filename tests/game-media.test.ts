import { describe, expect, it } from "vitest";
import { gameGalleryMedia, parseScreenshotUrls } from "@/lib/game-media";

describe("game media helpers", () => {
  it("parses only valid screenshot urls", () => {
    expect(parseScreenshotUrls(JSON.stringify(["a.png", "", 7, "b.png"]))).toEqual([
      "a.png",
      "b.png",
    ]);
    expect(parseScreenshotUrls("not json")).toEqual([]);
  });

  it("prioritizes screenshots over covers", () => {
    expect(
      gameGalleryMedia({
        screenshots: JSON.stringify(["shot-1.png", "shot-2.png"]),
        horizontalCoverUrl: "horizontal.png",
        coverUrl: "vertical.png",
      }),
    ).toEqual([
      { src: "shot-1.png", kind: "screenshot" },
      { src: "shot-2.png", kind: "screenshot" },
    ]);
  });

  it("falls back to horizontal cover and then vertical cover", () => {
    expect(
      gameGalleryMedia({
        screenshots: "[]",
        horizontalCoverUrl: "horizontal.png",
        coverUrl: "vertical.png",
      }),
    ).toEqual([{ src: "horizontal.png", kind: "horizontalCover" }]);

    expect(
      gameGalleryMedia({
        screenshots: "[]",
        coverUrl: "vertical.png",
      }),
    ).toEqual([{ src: "vertical.png", kind: "verticalCover" }]);
  });
});
