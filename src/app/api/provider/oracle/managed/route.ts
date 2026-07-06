import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { revertToManagedOracle } from "@/lib/oracle-keys";

// Vuelve al oráculo GESTIONADO por Luna (deshace el modo BYO). Auth = sesión humana
// dueña del proveedor. Genera un par nuevo custodiado por Luna: los 1341 vuelven a
// salir por /result + API key. OJO: cambia la pubkey del oráculo, así que invalida
// eventos firmados con la clave anterior.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
    select: { id: true },
  });
  if (!provider) {
    return NextResponse.json({ error: "No tenés proveedor" }, { status: 404 });
  }
  try {
    const oraclePubkey = await revertToManagedOracle(provider.id);
    return NextResponse.json({ oraclePubkey, selfSigned: false });
  } catch {
    return NextResponse.json(
      { error: "ORACLE_ENC_KEY no configurada en el servidor" },
      { status: 500 },
    );
  }
}
