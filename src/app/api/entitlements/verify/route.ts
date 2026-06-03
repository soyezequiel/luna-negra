import { NextResponse } from "next/server";
import { verifyEntitlement } from "@/lib/auth";

// Endpoint público: lo llama el server del juego (otro origen) → CORS abierto.
// El token es corto y autocontenido, así que devolver su info no es sensible.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { valid: false, error: "falta token" },
      { status: 400, headers: CORS },
    );
  }
  const ent = await verifyEntitlement(token);
  if (!ent) {
    return NextResponse.json({ valid: false }, { headers: CORS });
  }
  return NextResponse.json(
    { valid: true, npub: ent.npub, gameId: ent.gameId, slug: ent.slug },
    { headers: CORS },
  );
}
