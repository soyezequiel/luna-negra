import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { rotateOracleKey } from "@/lib/oracle-keys";

// Rota la clave del oráculo gestionado del proveedor (auth = sesión humana de
// /provider, NO API key). Devuelve solo la nueva pubkey. OJO: invalida los
// eventos firmados con la clave anterior (un self-signer debe pasar a la nueva).
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
    const oraclePubkey = await rotateOracleKey(provider.id);
    return NextResponse.json({ oraclePubkey });
  } catch {
    return NextResponse.json(
      { error: "ORACLE_ENC_KEY no configurada en el servidor" },
      { status: 500 },
    );
  }
}
