import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  const games = provider
    ? await prisma.game.findMany({
        where: { providerId: provider.id },
        orderBy: { createdAt: "desc" },
      })
    : [];
  return NextResponse.json({ provider, games });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { name, lightningAddress } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
  }

  const existing = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  const data = {
    name: name.trim(),
    lightningAddress:
      typeof lightningAddress === "string" && lightningAddress.trim()
        ? lightningAddress.trim()
        : null,
  };

  const provider = existing
    ? await prisma.provider.update({ where: { id: existing.id }, data })
    : await prisma.provider.create({
        data: { ...data, ownerId: session.sub, status: "approved" },
      });

  return NextResponse.json({ provider });
}
