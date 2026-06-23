import { NextResponse } from "next/server";
import { BUILD_ID } from "@/lib/build-id";

// El cliente sondea este endpoint para saber si está corriendo un build viejo
// (ver `FreshGuard`). Tiene que devolver SIEMPRE el valor del proceso vivo, sin
// cachear, o el sondeo nunca vería el deploy nuevo.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { v: BUILD_ID },
    { headers: { "Cache-Control": "no-store" } },
  );
}
