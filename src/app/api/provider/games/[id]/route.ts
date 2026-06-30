import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownedGame } from "@/lib/provider";
import { normalizeCategories } from "@/lib/categories";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-description";
import { normalizeImageUrl } from "@/lib/game-media";
import { revalidateCatalog } from "@/lib/store-catalog";
import { syncGameToNostr } from "@/lib/announce-game";
import { getEconomySettings, normalizePercent } from "@/lib/economy-settings";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await ownedGame(session, id);
  if (!owned) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim())
    data.title = body.title.trim();
  if (typeof body.description === "string")
    data.description = sanitizeDescriptionHtml(body.description.trim());
  if (body.categories !== undefined)
    data.categories = normalizeCategories(body.categories);
  if (body.priceSats !== undefined)
    data.priceSats = Math.max(0, Math.floor(Number(body.priceSats) || 0));
  if (typeof body.gameUrl === "string")
    data.gameUrl = body.gameUrl.trim() || null;
  if (typeof body.coverUrl === "string")
    data.coverUrl = normalizeImageUrl(body.coverUrl) || null;
  if (typeof body.horizontalCoverUrl === "string")
    data.horizontalCoverUrl = normalizeImageUrl(body.horizontalCoverUrl) || null;
  if (Array.isArray(body.screenshots))
    data.screenshots = JSON.stringify(
      body.screenshots
        .filter((s: unknown) => typeof s === "string")
        .map((s: string) => normalizeImageUrl(s)),
    );
  if (Array.isArray(body.videos))
    data.videos = JSON.stringify(
      body.videos
        .filter((s: unknown) => typeof s === "string")
        .map((s: string) => (s as string).trim())
        .filter((s: string) => s !== ""),
    );
  if (typeof body.supportsChallenges === "boolean")
    data.supportsChallenges = body.supportsChallenges;
  if (typeof body.isBeta === "boolean") data.isBeta = body.isBeta;
  // Override por juego del corte del dev en apuestas: null/"" = usar el default del
  // proveedor. Se acota al tope global (la misma cota se reaplica al crear apuestas).
  if (body.betDevFeePct !== undefined) {
    if (body.betDevFeePct === null || body.betDevFeePct === "") {
      data.betDevFeePct = null;
    } else {
      try {
        const economy = await getEconomySettings();
        data.betDevFeePct = Math.min(
          normalizePercent(body.betDevFeePct, "El corte de apuestas del juego"),
          economy.betDevFeeMaxPct,
        );
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Porcentaje invalido" },
          { status: 400 },
        );
      }
    }
  }

  let game = await prisma.game.update({ where: { id }, data });
  // Si está publicado, el artículo NIP-23 es la fuente de verdad: re-firmamos con
  // los datos nuevos (misma coordenada → comentarios intactos) y re-cacheamos.
  // Best-effort: si no hay clave/relays, la edición igual queda en la DB.
  if (game.status === "published") {
    try {
      game = await syncGameToNostr(game, req);
    } catch (err) {
      console.error("[provider edit] no se pudo re-publicar el artículo:", err);
    }
  }
  // El proveedor editó su ficha publicada → refrescar caché del catálogo.
  revalidateCatalog();
  return NextResponse.json({ game });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await ownedGame(session, id);
  if (!owned) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  const purchases = await prisma.purchase.count({ where: { gameId: id } });
  if (purchases > 0) {
    return NextResponse.json(
      { error: "No se puede borrar: tiene compras. Despublicalo en su lugar." },
      { status: 400 },
    );
  }
  await prisma.review.deleteMany({ where: { gameId: id } });
  await prisma.game.delete({ where: { id } });
  revalidateCatalog();
  return NextResponse.json({ ok: true });
}
