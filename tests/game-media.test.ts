import { describe, expect, it } from "vitest";
import {
  gameGalleryMedia,
  normalizeImageUrl,
  parseScreenshotUrls,
} from "@/lib/game-media";

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

  it("normalizes the active gallery src", () => {
    expect(
      gameGalleryMedia({
        screenshots: "[]",
        horizontalCoverUrl:
          "https://github.com/fchurca/vesta/blob/master/doc/vesta-banner.png",
      }),
    ).toEqual([
      {
        src: "https://raw.githubusercontent.com/fchurca/vesta/master/doc/vesta-banner.png",
        kind: "horizontalCover",
      },
    ]);
  });
});

describe("normalizeImageUrl", () => {
  it("rewrites a GitHub blob page URL to its raw content URL", () => {
    expect(
      normalizeImageUrl(
        "https://github.com/fchurca/vesta/blob/master/doc/vesta-banner.png",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/fchurca/vesta/master/doc/vesta-banner.png",
    );
  });

  it("strips query/hash from the blob ref", () => {
    expect(
      normalizeImageUrl("https://github.com/u/r/blob/main/a/b.png?raw=true#x"),
    ).toBe("https://raw.githubusercontent.com/u/r/main/a/b.png");
  });

  it("rewrites a Dropbox share link to a direct host", () => {
    expect(
      normalizeImageUrl("https://www.dropbox.com/s/abc/pic.png?dl=0"),
    ).toBe("https://dl.dropboxusercontent.com/s/abc/pic.png");
  });

  it("leaves already-valid and unknown URLs untouched", () => {
    const raw = "https://raw.githubusercontent.com/u/r/main/a.png";
    expect(normalizeImageUrl(raw)).toBe(raw);
    expect(normalizeImageUrl("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    expect(normalizeImageUrl("  ")).toBe("");
    expect(normalizeImageUrl(null)).toBe("");
  });
});
