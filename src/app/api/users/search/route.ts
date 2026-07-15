import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * Busca miembros de Luna Negra por nombre o código de amistad. Complementa la
 * búsqueda en relays Nostr (NIP-50): un miembro custodial creado en la tienda
 * puede no estar indexado allí, pero la tienda sí conoce su displayName.
 * Devuelve siempre `isMember: true` para que el cliente los promueva.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const code = /^\d{1,6}$/.test(q) ? Number(q) : null;
  if (q.length < 2 && code === null) return NextResponse.json({ users: [] });

  const select = {
    pubkey: true,
    npub: true,
    displayName: true,
    avatarUrl: true,
    friendCode: true,
  } as const;
  const [codeMatch, nameMatches] = await Promise.all([
    code === null
      ? null
      : prisma.user.findUnique({ where: { friendCode: code }, select }),
    q.length < 2
      ? []
      : prisma.user.findMany({
          where: {
            displayName: { contains: q, mode: "insensitive" },
            // No incluirse a sí mismo en los resultados.
            pubkey: { not: session.pubkey },
          },
          select,
          orderBy: { displayName: "asc" },
          take: 10,
        }),
  ]);
  const users = [
    ...(codeMatch && codeMatch.pubkey !== session.pubkey ? [codeMatch] : []),
    ...nameMatches.filter((u) => u.pubkey !== codeMatch?.pubkey),
  ].slice(0, 10);

  return NextResponse.json({
    users: users.map((u) => ({
      pubkey: u.pubkey,
      npub: u.npub,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      friendCode: u.friendCode,
      isMember: true,
    })),
  });
}
