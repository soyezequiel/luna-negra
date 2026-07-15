import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownedGame } from "@/lib/provider";
import { normalizeCategories } from "@/lib/categories";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-description";
import { normalizeImageUrl } from "@/lib/game-media";
import { revalidateCatalog } from "@/lib/store-catalog";
import { syncGameToNostr } from "@/lib/announce-game";
import { validateProviderDeletion } from "@/lib/game-article-validate";
import { broadcastSignedEvent } from "@/lib/nostr-server";
import { getEconomySettings, normalizePercent } from "@/lib/economy-settings";
import { MANUAL_CAP_KEYS } from "@/lib/integration-ngp";
import {
  isMigratableCap,
  PURCHASE_CAP,
  type CapMode,
} from "@/lib/capability-mode";

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
  if (typeof body.balCompatible === "boolean") {
    const current =
      owned.game.manualCaps && typeof owned.game.manualCaps === "object"
        ? (owned.game.manualCaps as Record<string, boolean>)
        : {};
    data.manualCaps = { ...current, bal: body.balCompatible };
  }
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
  // Declaración manual de una capacidad NGP no observable (login, presencia): se
  // fusiona sobre el mapa existente. Solo se aceptan claves de MANUAL_CAP_KEYS.
  if (body.manualCap && typeof body.manualCap === "object") {
    const { key, value } = body.manualCap as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || !MANUAL_CAP_KEYS.includes(key)) {
      return NextResponse.json({ error: "Capacidad no declarable" }, { status: 400 });
    }
    const current =
      (data.manualCaps as Record<string, boolean> | undefined) ??
      (owned.game.manualCaps && typeof owned.game.manualCaps === "object"
        ? (owned.game.manualCaps as Record<string, boolean>)
        : {});
    data.manualCaps = { ...current, [key]: !!value };
  }
  // Migración por capacidad de la interfaz Luna (REST) a NGP: elige
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
  // Activar/desactivar la verificación de compra (§2). "off" = acceso abierto (el
  // juego deja de requerir compra; verify responde valid:true para cualquiera). Se
  // guarda en el mismo Game.capsMode bajo la clave "purchase". Puede combinarse con
  // legMode en la misma request (se fusionan sobre el mapa ya calculado).
  if (body.purchaseMode !== undefined) {
    const value = body.purchaseMode;
    if (value !== "on" && value !== "off") {
      return NextResponse.json({ error: "Modo inválido (on|off)" }, { status: 400 });
    }
    const current =
      (data.capsMode as Record<string, string> | undefined) ??
      (owned.game.capsMode && typeof owned.game.capsMode === "object"
        ? (owned.game.capsMode as Record<string, string>)
        : {});
    data.capsMode = { ...current, [PURCHASE_CAP]: value };
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

  // ¿La edición toca campos que van al artículo NIP-23? (manualCaps/capsMode/
  // betDevFeePct no forman parte del artículo). Determina la invalidación de la
  // firma pendiente y la re-publicación del artículo.
  const ARTICLE_FIELDS = [
    "title",
    "description",
    "categories",
    "priceSats",
    "gameUrl",
    "coverUrl",
    "horizontalCoverUrl",
    "screenshots",
    "videos",
  ] as const;
  const touchesArticle = ARTICLE_FIELDS.some((k) => k in data);

  // Régimen "provider": el server NO puede re-firmar el artículo por el proveedor.
  // - draft/in_review: la firma guardada (si había) dejó de corresponder a la
  //   ficha → se borra; el proveedor re-firma antes de que el admin apruebe.
  // - published: la DB queda transitoriamente adelante de Nostr → articleDirty
  //   lo hace visible, y la respuesta pide la firma (needsSignature) para que el
  //   cliente encadene la firma y difusión.
  if (touchesArticle && owned.game.articleSigner === "provider") {
    if (owned.game.status === "published") {
      data.articleDirty = true;
    }
    if (owned.game.signedArticle !== null) {
      data.signedArticle = Prisma.DbNull;
    }
  }

  let game = await prisma.game.update({ where: { id }, data });
  // Si está publicado, el artículo NIP-23 es la fuente de verdad: hay que
  // re-publicarlo con los datos nuevos (misma coordenada → comentarios intactos).
  // - "store" (legacy): re-firmamos server-side con la clave de la tienda.
  // - "provider": lo firma el proveedor; el cliente encadena la firma al ver
  //   needsSignature (o queda el botón "Firmar y difundir" si cancela).
  let needsSignature = false;
  if (game.status === "published") {
    if (game.articleSigner === "provider") {
      needsSignature = touchesArticle;
    } else {
      try {
        game = await syncGameToNostr(game, req);
      } catch (err) {
        console.error("[provider edit] no se pudo re-publicar el artículo:", err);
      }
    }
  }
  // El proveedor editó su ficha publicada → refrescar caché del catálogo.
  revalidateCatalog();
  return NextResponse.json({ game, needsSignature });
}

export async function DELETE(
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

  const purchases = await prisma.purchase.count({ where: { gameId: id } });
  if (purchases > 0) {
    return NextResponse.json(
      { error: "No se puede borrar: tiene compras. Despublicalo en su lugar." },
      { status: 400 },
    );
  }

  // Retractación NIP-09 (kind:5) del artículo, firmada por el PROVEEDOR en su
  // navegador (régimen "provider"). Best-effort explícito: si no vino, no valida
  // o ningún relay la acepta, el borrado en DB procede igual (el artículo queda
  // huérfano en relays, como pasaba siempre con el borrado legacy).
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if (
    body.deleteEvent &&
    owned.game.articleSigner === "provider" &&
    owned.game.nostrEventId
  ) {
    try {
      const owner = await prisma.user.findUnique({
        where: { id: owned.provider.ownerId },
        select: { pubkey: true },
      });
      if (owner?.pubkey && owner.pubkey === session.pubkey) {
        const check = validateProviderDeletion({
          signedEvent: body.deleteEvent,
          expectedPubkey: owner.pubkey,
          nostrEventId: owned.game.nostrEventId,
          nostrCoord: owned.game.nostrCoord,
        });
        if (check.ok) void broadcastSignedEvent(check.event);
      }
    } catch (err) {
      console.error("[provider delete] no se pudo difundir el kind:5:", err);
    }
  }

  await prisma.review.deleteMany({ where: { gameId: id } });
  await prisma.game.delete({ where: { id } });
  revalidateCatalog();
  return NextResponse.json({ ok: true });
}
