import { NextResponse } from "next/server";
import { BETS_V1_ENABLED } from "@/lib/escrow-config";

/**
 * Guard del camino de retiro del motor v1 (ver BETS_V1_ENABLED). Con el flag
 * apagado, todos los endpoints v1 responden 410 Gone sin tocar el motor.
 * Devuelve null con el flag encendido (default): comportamiento intacto.
 */
export function betsV1Gone(): NextResponse | null {
  if (BETS_V1_ENABLED) return null;
  return NextResponse.json(
    {
      error: "GONE",
      message:
        "las apuestas v1 fueron retiradas de este servidor; migrá a la API v2 o a NGE (docs/nge/nge-v2-spec.md)",
    },
    { status: 410 },
  );
}
