import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkZapReadiness, checkAddressReadiness } from "@/lib/zap-readiness";

// ¿El usuario logueado está apto para recibir zaps sociales al ganar una apuesta?
// GET sin params → evalúa su destino real (método de cobro + cascada lud16).
// GET ?address=usuario@dominio → prueba una dirección candidata (para guiarlo antes
// de guardarla). Auth por cookie de sesión; sondea el LNURL del wallet, así que
// depende de red y no se cachea.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const probe = new URL(req.url).searchParams.get("address")?.trim();
  if (probe) {
    return NextResponse.json(await checkAddressReadiness(probe));
  }

  return NextResponse.json(
    await checkZapReadiness({ npub: session.npub, pubkey: session.pubkey }),
  );
}
