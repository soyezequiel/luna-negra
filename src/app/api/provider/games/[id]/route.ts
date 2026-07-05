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
import { MANUAL_CAP_KEYS } from "@/lib/integration-2";
import { isMigratableCap, type CapMode } from "@/lib/capability-mode";

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
  // Declaración manual de una capacidad 2.0 no observable (login, presencia): se
  // fusiona sobre el mapa existente. Solo se aceptan claves de MANUAL_CAP_KEYS.
  if (body.manualCap && typeof body.manualCap === "object") {
    const { key, value } = body.manualCap as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || !MANUAL_CAP_KEYS.includes(key)) {
      return NextResponse.json({ error: "Capacidad no declarable" }, { status: 400 });
    }
    const current =
      owned.game.manualCaps && typeof owned.game.manualCaps === "object"
        ? (owned.game.manualCaps as Record<string, boolean>)
        : {};
    data.manualCaps = { ...current, [key]: !!value };
  }
  // Migración por capacidad de la interfaz Luna (REST) a la interfaz Nostr: elige
  // por cuál riel corre una capacidad intermedia. "nostr" apaga la pata Luna de esa
  // capacidad (su endpoint devuelve 409). Se fusiona sobre Game.capsMode. Solo se
  // aceptan capacidades migrables (MIGRATABLE_CAPS) y los dos modos válidos.
  if (body.legMode && typeof body.legMode === "object") {
    const { key, value } = body.legMode as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || !isMigratableCap(key)) {
      return NextResponse.json({ error: "Capacidad no migrable" }, { status: 400 });
    }
    if (value !== "luna" && value !== "nostr") {
      return NextResponse.json({ error: "Modo inválido (luna|nostr)" }, { status: 400 });
    }
    const current =
      owned.game.capsMode && typeof owned.game.capsMode === "object"
        ? (owned.game.capsMode as Record<string, CapMode>)
        : {};
    data.capsMode = { ...current, [key]: value };
  }
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
