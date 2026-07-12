import { prisma } from "@/lib/prisma";
import { getStorePubkey } from "@/lib/nostr-server";

// Coordenadas Nostr (`30023:<pubkey>:<slug>`) de los juegos PUBLICADOS de la
// tienda + la pubkey de la tienda. Información pública (aparece en cada
// artículo del catálogo). El riel de amigos (cliente) la consulta para
// reconocer la presencia NGP anclada por coordenada: con artículos firmados por
// el PROVEEDOR (articleSigner="provider") el prefijo `30023:<pubkey-tienda>:` ya
// no alcanza — la coord de cada juego lleva la pubkey de SU firmante, así que
// hay que matchear contra la lista real.
export const dynamic = "force-dynamic";

export async function GET() {
  const games = await prisma.game.findMany({
    where: { status: "published", nostrCoord: { not: null } },
    select: { slug: true, nostrCoord: true },
  });
  const coords: Record<string, string> = {};
  for (const g of games) {
    if (g.nostrCoord) coords[g.slug] = g.nostrCoord;
  }
  return Response.json(
    { pubkey: getStorePubkey(), coords },
    // El catálogo publicado cambia poco: cache corto compartido para no pegarle
    // a la DB en cada refresco del riel de amigos.
    { headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=600" } },
  );
}
