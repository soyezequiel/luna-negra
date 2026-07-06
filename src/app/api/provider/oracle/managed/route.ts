import { NextResponse } from "next/server";
import { providerIdFromRequest } from "@/lib/provider-auth";
import { revertToManagedOracle } from "@/lib/oracle-keys";

// Vuelve al oráculo GESTIONADO por Luna (deshace el modo BYO). Auth = sesión humana
// dueña del proveedor O Bearer API key del proveedor. Genera un par nuevo custodiado
// por Luna: los 1341 vuelven a salir por /result + API key. OJO: cambia la pubkey del
// oráculo, así que invalida eventos firmados con la clave anterior.
export async function POST(req: Request) {
  const providerId = await providerIdFromRequest(req);
  if (!providerId) {
    return NextResponse.json({ error: "No autenticado como proveedor" }, { status: 401 });
  }
  try {
    const oraclePubkey = await revertToManagedOracle(providerId);
    return NextResponse.json({ oraclePubkey, selfSigned: false });
  } catch {
    return NextResponse.json(
      { error: "ORACLE_ENC_KEY no configurada en el servidor" },
      { status: 500 },
    );
  }
}
