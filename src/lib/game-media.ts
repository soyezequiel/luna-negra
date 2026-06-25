export type GameGalleryMedia = {
  src: string;
  kind: "video" | "screenshot" | "horizontalCover" | "verticalCover";
};

/**
 * Corrige enlaces que apuntan a la *página* que muestra una imagen en vez de
 * a los bytes de la imagen — el error típico de pegar la URL del navegador.
 * Devuelve la URL tal cual si no reconoce el patrón.
 */
export function normalizeImageUrl(url: string | null | undefined): string {
  const value = (url || "").trim();
  if (!value) return "";

  // GitHub: github.com/{user}/{repo}/blob/{rest} → raw.githubusercontent.com/{user}/{repo}/{rest}
  const gh = value.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i,
  );
  if (gh) {
    const rest = gh[3].replace(/[?#].*$/, "");
    return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${rest}`;
  }

  // Dropbox: los enlaces compartidos sirven una vista previa HTML; el host
  // dl.dropboxusercontent.com entrega el archivo directo.
  if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(value)) {
    return value
      .replace(/^https?:\/\/(www\.)?dropbox\.com\//i, "https://dl.dropboxusercontent.com/")
      .replace(/[?&]dl=0\b/i, "");
  }

  return value;
}

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

/** URLs de video (trailers). Mismo formato JSON que las capturas. */
export function parseVideoUrls(value: string | null | undefined): string[] {
  return parseScreenshotUrls(value);
}

export function gameGalleryMedia(game: {
  screenshots: string | null;
  videos?: string | null;
  horizontalCoverUrl?: string | null;
  coverUrl?: string | null;
}): GameGalleryMedia[] {
  // Como Steam: los trailers van primero, después las capturas.
  const videos: GameGalleryMedia[] = parseVideoUrls(game.videos).map((src) => ({
    src: normalizeImageUrl(src),
    kind: "video",
  }));
  const screenshots: GameGalleryMedia[] = parseScreenshotUrls(game.screenshots).map(
    (src) => ({ src: normalizeImageUrl(src), kind: "screenshot" }),
  );
  if (videos.length > 0 || screenshots.length > 0) {
    return [...videos, ...screenshots];
  }

  if (game.horizontalCoverUrl) {
    return [{ src: normalizeImageUrl(game.horizontalCoverUrl), kind: "horizontalCover" }];
  }

  if (game.coverUrl) {
    return [{ src: normalizeImageUrl(game.coverUrl), kind: "verticalCover" }];
  }

  return [];
}
