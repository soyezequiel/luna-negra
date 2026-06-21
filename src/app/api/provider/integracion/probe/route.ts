import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { runProbe } from "@/lib/integration-probe";
import { siteUrl } from "@/lib/site-url";

// Probador en vivo del proveedor logueado: golpea los endpoints reales del
// contrato público y devuelve pass/fail por interfaz.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
    select: { id: true },
  });
  if (!provider) {
    return NextResponse.json({ error: "No tenés un proveedor" }, { status: 404 });
  }

  const results = await runProbe({ providerId: provider.id, origin: siteUrl(req) });
  return NextResponse.json({ results });
}
