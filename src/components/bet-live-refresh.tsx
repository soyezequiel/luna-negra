"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresca la apuesta v2 (server component) mientras está en curso, para que la
 * lista de "Participantes", el contador de depósitos y el estado se actualicen
 * solos cuando alguien deposita — sin recargar la página. `router.refresh()`
 * re-ejecuta el RSC preservando el estado de los componentes cliente (la tarjeta
 * de depósito conserva su invoice/QR). Cuando la apuesta deja de estar activa,
 * el server deja de pasar `active` y el polling se detiene.
 */
export function BetLiveRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  return null;
}
