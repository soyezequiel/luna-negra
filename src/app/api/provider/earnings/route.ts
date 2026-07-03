import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getProviderBetEarnings } from "@/lib/earnings";

// Lo que ganó el proveedor por apuestas (dev_fee, v1 + v2), agregado sobre todos
// sus juegos. Complementa /api/provider/sales (ganancias por ventas).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
    select: { id: true },
  });
  if (!provider) return NextResponse.json({ earnings: null });

  const earnings = await getProviderBetEarnings(provider.id);
  return NextResponse.json({ earnings });
}
