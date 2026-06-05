import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Revoca (no borra) una API key del proveedor del usuario.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  if (!provider) {
    return NextResponse.json({ error: "Sin proveedor" }, { status: 404 });
  }
  const { keyId } = await params;
  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key || key.providerId !== provider.id) {
    return NextResponse.json({ error: "Clave no encontrada" }, { status: 404 });
  }
  await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
