import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ownedGame } from "@/lib/provider";
import { gamePageUrl } from "@/lib/site-url";
import {
  buildGameArticleTemplate,
  gameArticleCoord,
} from "@/lib/game-article";

/**
 * Template CANÓNICO (sin firmar) del artículo NIP-23 del juego, para que el
 * proveedor lo firme en su navegador (régimen `articleSigner === "provider"`).
 * Lo construye el SERVER con los mismos campos/saneado que ve el admin en la DB
 * — el cliente lo firma tal cual, sin tocarlo; cualquier diferencia la rechaza
 * validateProviderArticle al recibir la firma. `published_at` preserva la fecha
 * del primer posteo (re-firmas y migración no "renuevan" el artículo).
 */
export async function GET(
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

  const owner = await prisma.user.findUnique({
    where: { id: owned.provider.ownerId },
    select: { pubkey: true },
  });
  if (!owner?.pubkey) {
    return NextResponse.json(
      { error: "El proveedor no tiene cuenta Nostr asociada" },
      { status: 400 },
    );
  }
  if (owner.pubkey !== session.pubkey) {
    return NextResponse.json(
      { error: "Tu sesión no corresponde a la cuenta dueña del proveedor" },
      { status: 403 },
    );
  }

  const game = owned.game;
  const publishedAt = game.nostrPublishedAt
    ? Math.floor(game.nostrPublishedAt.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const template = buildGameArticleTemplate(game, {
    gamePageUrl: gamePageUrl(req, game.slug),
    publishedAt,
  });

  return NextResponse.json({
    template,
    // Coordenada que va a tener el artículo firmado por el proveedor. Sirve para
    // que el cliente pre-chequee que el signer activo es la cuenta correcta.
    coord: gameArticleCoord(owner.pubkey, game.slug),
    ownerPubkey: owner.pubkey,
  });
}
