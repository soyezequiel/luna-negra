import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_LAUNCH_URL_LENGTH = 4096;

function normalizedPathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

/**
 * Reconoce la URL canónica de un juego aunque lleve parámetros efímeros de sala.
 * Los parámetros declarados en `Game.gameUrl` sí deben conservarse, para no
 * confundir dos deployments que comparten host y pathname.
 */
function launchUrlMatchesGame(candidate: URL, gameUrl: string): boolean {
  try {
    const registered = new URL(gameUrl);
    if (candidate.origin !== registered.origin) return false;
    if (normalizedPathname(candidate.pathname) !== normalizedPathname(registered.pathname)) {
      return false;
    }
    for (const [key, value] of registered.searchParams) {
      if (!candidate.searchParams.getAll(key).includes(value)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Resuelve metadata local para lanzar con BAL una URL recibida tal como fue
 * compartida. Este endpoint no genera ni modifica el Room Link.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!rawUrl || rawUrl.length > MAX_LAUNCH_URL_LENGTH) {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  let candidate: URL;
  try {
    candidate = new URL(rawUrl);
    if (
      !["http:", "https:"].includes(candidate.protocol)
      || candidate.username
      || candidate.password
    ) {
      throw new Error("unsupported URL");
    }
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  const games = await prisma.game.findMany({
    where: { status: "published", gameUrl: { not: null } },
    select: {
      slug: true,
      title: true,
      gameUrl: true,
      manualCaps: true,
    },
  });
  const game = games.find(
    (entry) => entry.gameUrl && launchUrlMatchesGame(candidate, entry.gameUrl),
  );
  if (!game) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    slug: game.slug,
    title: game.title,
    balCompatible: !!(
      game.manualCaps as Record<string, boolean> | null
    )?.bal,
  });
}
