import { NextResponse } from "next/server";
import { SimplePool, nip19, verifyEvent, type Event } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { RELAYS } from "@/lib/constants";
import {
  GAME_ARTICLE_KIND,
  gameArticleCoord,
  parseGameArticle,
} from "@/lib/game-article";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-description";
import { getEconomySettings } from "@/lib/economy-settings";
import { notifyGameSubmitted } from "@/lib/discord";
import { siteUrl } from "@/lib/site-url";

/**
 * Adopta un artículo NIP-23 YA PUBLICADO en Nostr como juego de la tienda: el
 * proveedor pega su `naddr1…` (o la coordenada cruda `30023:<pubkey>:<slug>`),
 * verificamos que el artículo esté FIRMADO POR SU CUENTA, lo levantamos de
 * relays y lo importamos como Game en revisión (el admin lo aprueba como
 * siempre — la revisión editorial queda fuera del protocolo). La identidad
 * Nostr (coord/evento) es la del artículo original: la tienda no re-publica
 * nada, solo lo agrega al catálogo.
 */

/** Descompone un naddr1… o una coord cruda en { kind, pubkey, slug, relays }. */
function parseAddress(
  raw: string,
): { kind: number; pubkey: string; slug: string; relays: string[] } | null {
  const value = raw.trim();
  if (value.startsWith("naddr1")) {
    try {
      const decoded = nip19.decode(value);
      if (decoded.type !== "naddr") return null;
      const d = decoded.data;
      return {
        kind: d.kind,
        pubkey: d.pubkey,
        slug: d.identifier,
        relays: d.relays ?? [],
      };
    } catch {
      return null;
    }
  }
  // Coordenada cruda `kind:pubkey:slug` (el slug puede contener `:`? No: los
  // slugs de la tienda son [a-z0-9-], así que el split en 3 partes alcanza).
  const parts = value.split(":");
  if (parts.length < 3) return null;
  const kind = Number(parts[0]);
  const pubkey = parts[1];
  const slug = parts.slice(2).join(":");
  if (!Number.isFinite(kind) || !/^[0-9a-f]{64}$/.test(pubkey) || !slug) return null;
  return { kind, pubkey, slug, relays: [] };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
    include: { owner: { select: { pubkey: true } } },
  });
  if (!provider) {
    return NextResponse.json(
      { error: "Creá tu perfil de proveedor primero" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const address = typeof body.address === "string" ? body.address : "";
  const parsed = parseAddress(address);
  if (!parsed) {
    return NextResponse.json(
      { error: "Dirección inválida: pegá un naddr1… o una coordenada 30023:<pubkey>:<slug>" },
      { status: 400 },
    );
  }
  if (parsed.kind !== GAME_ARTICLE_KIND) {
    return NextResponse.json(
      { error: `Eso no es un artículo de juego (kind:${GAME_ARTICLE_KIND})` },
      { status: 400 },
    );
  }
  // El artículo debe estar firmado por LA CUENTA DUEÑA del proveedor logueado:
  // adoptar el artículo de un tercero secuestraría su coordenada (y toda la
  // actividad que cuelga de ella).
  if (parsed.pubkey !== session.pubkey || parsed.pubkey !== provider.owner.pubkey) {
    return NextResponse.json(
      { error: "Ese artículo no está firmado por tu cuenta Nostr" },
      { status: 403 },
    );
  }

  // Colisión de slug: el slug del Game DEBE igualar el tag `d` de la coordenada
  // (todo lo NGP matchea por coord exacta), así que no se puede sufilar.
  const existing = await prisma.game.findUnique({ where: { slug: parsed.slug } });
  if (existing) {
    return NextResponse.json(
      { error: `Ya existe un juego con el slug "${parsed.slug}" en la tienda` },
      { status: 409 },
    );
  }

  // Levantamos el artículo de los relays (los del naddr + los de la tienda) y
  // nos quedamos con la versión más nueva verificada.
  const relays = [...new Set([...RELAYS, ...parsed.relays])];
  const pool = new SimplePool();
  let events: Event[] = [];
  try {
    events = await pool.querySync(
      relays,
      { kinds: [GAME_ARTICLE_KIND], authors: [parsed.pubkey], "#d": [parsed.slug] },
      { maxWait: 5000 },
    );
  } catch {
    events = [];
  } finally {
    pool.close(relays);
  }
  const newest = events
    .filter((ev) => {
      try {
        return verifyEvent(ev);
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.created_at - a.created_at)[0];
  if (!newest) {
    return NextResponse.json(
      { error: "No encontramos ese artículo en los relays (¿está publicado?)" },
      { status: 404 },
    );
  }

  const article = parseGameArticle(newest);
  if (!article) {
    return NextResponse.json(
      { error: "El artículo no tiene forma de ficha de juego (falta el tag d)" },
      { status: 400 },
    );
  }

  const economy = await getEconomySettings();
  const game = await prisma.game.create({
    data: {
      providerId: provider.id,
      slug: article.slug,
      title: article.title || article.slug,
      description: sanitizeDescriptionHtml(article.description),
      categories: article.categories,
      priceSats: article.priceSats,
      coverUrl: article.coverUrl,
      horizontalCoverUrl: article.horizontalCoverUrl,
      screenshots: article.screenshots,
      videos: article.videos,
      gameUrl: article.gameUrl,
      status: "in_review",
      articleSigner: "provider",
      // Identidad Nostr = la del artículo ORIGINAL (la tienda no re-publica).
      nostrEventId: newest.id,
      nostrPubkey: newest.pubkey,
      nostrCoord: gameArticleCoord(newest.pubkey, article.slug),
      nostrPublishedAt: article.publishedAt
        ? new Date(article.publishedAt * 1000)
        : new Date(newest.created_at * 1000),
      nostrUpdatedAt: new Date(newest.created_at * 1000),
      // Guardamos el evento para que el approve reutilice el camino provider
      // (re-difundir un replaceable ya publicado es idempotente e inocuo).
      signedArticle: JSON.parse(JSON.stringify(newest)),
      revenueShare: economy.providerRevenueShare,
    },
  });

  // Aviso al equipo por Discord (best-effort, igual que el submit clásico).
  await notifyGameSubmitted({
    title: game.title,
    providerName: provider.name,
    priceSats: game.priceSats,
    description: game.description,
    categories: game.categories,
    adminUrl: `${siteUrl(req)}/admin`,
  });

  return NextResponse.json({ game }, { status: 201 });
}
