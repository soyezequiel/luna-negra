export type GameGalleryMedia = {
  src: string;
  kind: "screenshot" | "horizontalCover" | "verticalCover";
};

export function parseScreenshotUrls(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((src): src is string => typeof src === "string" && src.trim() !== "")
      : [];
  } catch {
    return [];
  }
}

export function gameGalleryMedia(game: {
  screenshots: string | null;
  horizontalCoverUrl?: string | null;
  coverUrl?: string | null;
}): GameGalleryMedia[] {
  const screenshots = parseScreenshotUrls(game.screenshots);
  if (screenshots.length > 0) {
    return screenshots.map((src) => ({ src, kind: "screenshot" }));
  }

  if (game.horizontalCoverUrl) {
    return [{ src: game.horizontalCoverUrl, kind: "horizontalCover" }];
  }

  if (game.coverUrl) {
    return [{ src: game.coverUrl, kind: "verticalCover" }];
  }

  return [];
}
