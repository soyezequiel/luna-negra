import { NextResponse } from "next/server";
import type { Event } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { oracleProofContent, setSelfSignedOracle } from "@/lib/oracle-keys";

// Declara la clave de oráculo PROPIA del proveedor (BYO, keyless — Slice 2). Auth =
// sesión humana dueña del proveedor (NO API key). El proveedor prueba posesión de la
// clave firmando un evento cuyo content es el reto ligado a su providerId; Luna lo
// verifica y guarda la pubkey SIN el secreto. Desde ahí Luna no firma resultados por
// él: el juego firma sus 1341 y los publica (o los postea a /result como {event}).

async function ownerProvider(): Promise<{ id: string } | null> {
  const session = await getSession();
  if (!session) return null;
  return prisma.provider.findFirst({
    where: { ownerId: session.sub },
    select: { id: true },
  });
}

// Reto determinístico que el proveedor debe firmar con su clave de oráculo.
export async function GET() {
  const provider = await ownerProvider();
  if (!provider) {
    return NextResponse.json({ error: "No tenés proveedor" }, { status: 404 });
  }
  return NextResponse.json({
    providerId: provider.id,
    challenge: oracleProofContent(provider.id),
    hint: "Firmá un evento Nostr con tu clave de oráculo cuyo content sea exactamente `challenge` y created_at reciente; enviá el evento firmado en { proof }.",
  });
}

export async function POST(req: Request) {
  const provider = await ownerProvider();
  if (!provider) {
    return NextResponse.json({ error: "No tenés proveedor" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const proof = body?.proof as Event | undefined;
  const res = await setSelfSignedOracle(provider.id, proof as Event);
  if (!res.ok) {
    return NextResponse.json({ error: res.message, code: res.code }, { status: 400 });
  }
  return NextResponse.json({ oraclePubkey: res.oraclePubkey, selfSigned: true });
}
