import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { uniqueGameSlug } from "@/lib/slug";
import { normalizeCategories } from "@/lib/categories";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-description";

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
        typeof body.coverUrl === "string" && body.coverUrl.trim()
          ? body.coverUrl.trim()
          : null,
      horizontalCoverUrl:
        typeof body.horizontalCoverUrl === "string" &&
        body.horizontalCoverUrl.trim()
          ? body.horizontalCoverUrl.trim()
          : null,
      screenshots: Array.isArray(body.screenshots)
        ? JSON.stringify(
            body.screenshots.filter((s: unknown) => typeof s === "string"),
          )
        : "[]",
      status: "draft",
    },
  });

  return NextResponse.json({ game });
}
