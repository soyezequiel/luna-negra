import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { notifyGameSubmitted } from "@/lib/discord";
import { siteUrl } from "@/lib/site-url";
import { checkProviderArticle } from "@/lib/provider-article";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  const { id } = await params;
  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || !provider || game.providerId !== provider.id) {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }
  if (game.status !== "draft") {
    return NextResponse.json(
      { error: "El juego no está en borrador" },
      { status: 400 },
    );
  }

  // Régimen "provider": el artículo NIP-23 lo firma EL PROVEEDOR en su navegador
  // y viaja adjunto al submit. Se valida contra la ficha canónica y queda
  // guardado SIN publicar; el admin lo difunde a relays al aprobar. Sin firma
  // válida no hay revisión (el admin no puede aprobar-publicar sin ella).
  let signedArticle: unknown = null;
  if (game.articleSigner === "provider") {
    const body = await req.json().catch(() => ({}));
    if (!body.signedEvent) {
      return NextResponse.json(
        { error: "Falta tu firma Nostr: firmá el artículo del juego para enviarlo a revisión" },
        { status: 400 },
      );
    }
    const check = await checkProviderArticle({
      game,
      provider,
      sessionPubkey: session.pubkey,
      signedEvent: body.signedEvent,
      req,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }
    signedArticle = check.event;
  }

  const updated = await prisma.game.update({
    where: { id },
    data: {
      status: "in_review",
      // El Event firmado es JSON plano (id/pubkey/sig/kind/tags/content/created_at).
      ...(signedArticle
        ? { signedArticle: signedArticle as Prisma.InputJsonValue }
        : {}),
    },
  });

  // Aviso al equipo por Discord (best-effort: no rompe el submit si falla).
  await notifyGameSubmitted({
    title: updated.title,
    providerName: provider.name,
    priceSats: updated.priceSats,
    description: updated.description,
    categories: updated.categories,
    adminUrl: `${siteUrl(req)}/admin`,
  });

  return NextResponse.json({ game: updated });
}
