import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reviews = await prisma.review.findMany({
    where: { gameId: id },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  const count = reviews.length;
  const average =
    count === 0 ? 0 : reviews.reduce((s, r) => s + r.rating, 0) / count;

  return NextResponse.json({
    count,
    average,
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      npub: r.user.npub,
      name: r.user.displayName,
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const rating = Math.floor(Number(body.rating));
  if (!(rating >= 1 && rating <= 5)) {
    return NextResponse.json({ error: "Rating inválido (1-5)" }, { status: 400 });
  }

  const owns = await prisma.purchase.findUnique({
    where: { userId_gameId: { userId: session.sub, gameId: id } },
  });
  if (owns?.status !== "paid") {
    return NextResponse.json(
      { error: "Tenés que tener el juego para reseñarlo" },
      { status: 403 },
    );
  }

  const text = typeof body.body === "string" ? body.body.trim().slice(0, 2000) : "";
  await prisma.review.upsert({
    where: { userId_gameId: { userId: session.sub, gameId: id } },
    update: { rating, body: text },
    create: { userId: session.sub, gameId: id, rating, body: text },
  });

  return NextResponse.json({ ok: true });
}
