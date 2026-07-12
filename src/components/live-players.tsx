"use client";

import { useEffect, useState } from "react";

// Cada cuánto refresca el conteo. En el server la presencia NIP-38 entra por
// suscripción persistente (reconcilia al instante), así que el poll del cliente
// es lo que domina la latencia del badge: 10s la deja en segundos sin cargar
// la API (la ruta lee memoria + una query liviana).
const POLL_INTERVAL_MS = 10_000;

/**
 * "Jugando ahora" estilo SteamDB, en la columna de metadatos de la ficha.
 * Unifica presencia 1.0 (GamePresence, REST) y NGP (NIP-38) vía
 * `GET /api/games/[gameId]/live`. Si el juego nunca tuvo presencia (0 ahora y
 * 0 de pico hoy) no se muestra: no hay nada que decir todavía.
 */
export function LivePlayers({ gameId }: { gameId: string }) {
  const [data, setData] = useState<{ now: number; peakToday: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/live`);
        if (!res.ok || cancelled) return;
        setData(await res.json());
      } catch {
        /* no crítico: si falla, no mostramos el dato (no rompemos la ficha) */
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [gameId]);

  if (!data || (data.now === 0 && data.peakToday === 0)) return null;

  return (
    <div className="flex justify-between py-1.5">
      <dt className="text-ln-faint">Jugando ahora</dt>
      <dd className="flex items-center gap-1.5 text-ln-text">
        {data.now > 0 ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ln-aurora-bright" />
        ) : null}
        <span className="font-semibold tabular-nums">{data.now}</span>
        <span className="text-ln-faint">· pico hoy {data.peakToday}</span>
      </dd>
    </div>
  );
}
