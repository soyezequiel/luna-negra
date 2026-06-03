import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const pubkeys: string[] = Array.isArray(body.pubkeys)
    ? body.pubkeys
        .filter((p: unknown) => typeof p === "string" && /^[0-9a-f]{64}$/i.test(p))
        .slice(0, 1000)
    : [];

  if (pubkeys.length === 0) return NextResponse.json({ known: [] });

  const users = await prisma.user.findMany({
    where: { pubkey: { in: pubkeys } },
    include: {
      purchases: {
        where: { status: "paid" },
        include: { game: true },
      },
    },
  });

  return NextResponse.json({
    known: users.map((u) => ({
      pubkey: u.pubkey,
      npub: u.npub,
      displayName: u.displayName,
      games: u.purchases.map((p) => ({
        slug: p.game.slug,
        title: p.game.title,
      })),
    })),
  });
}
