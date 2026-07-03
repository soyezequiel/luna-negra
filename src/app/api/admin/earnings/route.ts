import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { getHouseEarnings } from "@/lib/earnings";

// Lo que ganó Luna Negra (la casa): corte de apuestas (fee, v1 + v2) + comisión de
// tienda sobre ventas. Solo admin.
export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session.pubkey)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const earnings = await getHouseEarnings();
  return NextResponse.json({ earnings });
}
