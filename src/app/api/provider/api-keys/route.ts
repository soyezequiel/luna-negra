import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { generateApiKey } from "@/lib/api-keys";

async function providerFor(sub: string) {
  return prisma.provider.findFirst({ where: { ownerId: sub } });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await providerFor(session.sub);
  if (!provider) return NextResponse.json({ keys: [] });

  const keys = await prisma.apiKey.findMany({
    where: { providerId: provider.id, revokedAt: null },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ keys });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await providerFor(session.sub);
  if (!provider) {
    return NextResponse.json(
      { error: "Creá tu perfil de proveedor primero" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 60)
      : "Clave de API";

  const { key, prefix, hash } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: { providerId: provider.id, name, prefix, hash },
  });

  // La clave en claro se devuelve UNA sola vez (no se vuelve a poder ver).
  return NextResponse.json(
    { id: created.id, name, prefix, key },
    { status: 201 },
  );
}
