import { NextResponse } from "next/server";
import type { Event } from "nostr-tools";
import { providerIdFromSession } from "@/lib/provider-auth";
import { oracleProofContent, setSelfSignedOracle } from "@/lib/oracle-keys";

// Declara la clave de oráculo PROPIA del proveedor (BYO, keyless — Slice 2). Auth =
// sesión humana dueña del proveedor O Bearer API key del proveedor (el game server
// se declara solo). El proveedor prueba posesión de la clave firmando un evento cuyo
// content es el reto ligado a su providerId; Luna lo verifica y guarda la pubkey SIN
// el secreto. Desde ahí Luna no firma resultados por él: el juego firma sus 1341 y
// los publica (o los postea a /result como {event}).

// Reto determinístico que el proveedor debe firmar con su clave de oráculo.
export async function GET() {
  const providerId = await providerIdFromSession();
  if (!providerId) {
    return NextResponse.json({ error: "No autenticado como proveedor" }, { status: 401 });
  }
  return NextResponse.json({
    providerId,
    challenge: oracleProofContent(providerId),
    hint: "Firmá un evento Nostr con tu clave de oráculo cuyo content sea exactamente `challenge` y created_at reciente; enviá el evento firmado en { proof }.",
  });
}

export async function POST(req: Request) {
  const providerId = await providerIdFromSession();
  if (!providerId) {
    return NextResponse.json({ error: "No autenticado como proveedor" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const proof = body?.proof as Event | undefined;
  const res = await setSelfSignedOracle(providerId, proof as Event);
  if (!res.ok) {
    return NextResponse.json({ error: res.message, code: res.code }, { status: 400 });
  }
  return NextResponse.json({ oraclePubkey: res.oraclePubkey, selfSigned: true });
}
