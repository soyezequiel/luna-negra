import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uniqueGameSlug } from "@/lib/slug";
import { normalizeCategories } from "@/lib/categories";
import { getEconomySettings } from "@/lib/economy-settings";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-description";
import { normalizeImageUrl } from "@/lib/game-media";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  if (!provider) {
    return NextResponse.json(
      { error: "Creá tu perfil de proveedor primero" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Falta el título" }, { status: 400 });
  }

  const economy = await getEconomySettings();
  // Override por juego del corte del dev: vacío/ausente = heredar el default del
  // proveedor (null). Si viene, se acota al tope global.
  let betDevFeePct: number | null = null;
  if (
    body.betDevFeePct !== undefined &&
    body.betDevFeePct !== null &&
    body.betDevFeePct !== ""
  ) {
    const n = Math.floor(Number(body.betDevFeePct));
    if (Number.isFinite(n) && n >= 0) {
      betDevFeePct = Math.min(n, economy.betDevFeeMaxPct);
    }
  }
  const game = await prisma.game.create({
    data: {
      providerId: provider.id,
      slug: await uniqueGameSlug(title),
      title,
      description:
        typeof body.description === "string"
          ? sanitizeDescriptionHtml(body.description.trim())
          : "",
      categories: normalizeCategories(body.categories),
      priceSats: Math.max(0, Math.floor(Number(body.priceSats) || 0)),
      gameUrl:
        typeof body.gameUrl === "string" && body.gameUrl.trim()
          ? body.gameUrl.trim()
          : null,
      coverUrl:
        typeof body.coverUrl === "string"
          ? normalizeImageUrl(body.coverUrl) || null
          : null,
      horizontalCoverUrl:
        typeof body.horizontalCoverUrl === "string"
          ? normalizeImageUrl(body.horizontalCoverUrl) || null
          : null,
      screenshots: Array.isArray(body.screenshots)
        ? JSON.stringify(
            body.screenshots
              .filter((s: unknown) => typeof s === "string")
              .map((s: string) => normalizeImageUrl(s)),
          )
        : "[]",
      videos: Array.isArray(body.videos)
        ? JSON.stringify(
            body.videos
              .filter((s: unknown) => typeof s === "string")
              .map((s: string) => (s as string).trim())
              .filter((s: string) => s !== ""),
          )
        : "[]",
      status: "draft",
      // Los juegos NUEVOS nacen en el régimen "provider": el artículo NIP-23 lo
      // firma el PROVEEDOR en su navegador (spec NGP: la coordenada es
      // `30023:<pubkey-del-dev>:<slug>`). "store" queda solo para legacy.
      articleSigner: "provider",
      revenueShare: economy.providerRevenueShare,
      betDevFeePct,
    },
  });

  return NextResponse.json({ game });
}
