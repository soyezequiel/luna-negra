import { NextResponse } from "next/server";
import { getJwks } from "@/lib/jwks";
import { CORS, corsPreflight } from "@/lib/api";

// Claves públicas (JWKS) para validar OFFLINE los tokens de dev (ES256).
// Servido también en /.well-known/jwks.json vía rewrite (ver next.config.ts).
export function OPTIONS() {
  return corsPreflight();
}

export async function GET() {
  const jwks = await getJwks();
  return NextResponse.json(jwks, {
    headers: { ...CORS, "Cache-Control": "public, max-age=300" },
  });
}
