import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * Busca miembros de Luna Negra por nombre. Complementa la búsqueda en relays
 * Nostr (NIP-50): un miembro custodial creado en la tienda puede no estar
 * indexado en ningún relay de búsqueda, pero la tienda sí conoce su displayName.
 * Devuelve siempre `isMember: true` para que el cliente los promueva.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ users: [] });

  const users = await prisma.user.findMany({
    where: {
      displayName: { contains: q, mode: "insensitive" },
      // No incluirse a sí mismo en los resultados.
      pubkey: { not: session.pubkey },
    },
    select: { pubkey: true, npub: true, displayName: true, avatarUrl: true },
    take: 10,
  });

  return NextResponse.json({
    users: users.map((u) => ({
      pubkey: u.pubkey,
      npub: u.npub,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      isMember: true,
    })),
  });
}
