"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { launchStandaloneGame } from "@/lib/room-launch";

/**
 * "Crear apuesta 1v1" — única entrada a apuestas en toda la app (vive solo en la
 * ficha del juego en modo biblioteca).
 *
 * Las apuestas con escrow las crea el propio juego vía su API REST cuando dos
 * jugadores se desafían dentro de la partida (ver oráculo gestionado por API
 * key). No hay endpoint de creación desde la tienda, así que acá explicamos el
 * flujo y abrimos el juego para iniciar el desafío.
 */
export function CreateBetButton({
  gameId,
  gameUrl,
  title,
  slug,
}: {
  gameId: string;
  gameUrl: string;
  title: string;
  slug: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function launch() {
    setLoading(true);
    try {
      const r = await fetch(`/api/games/${gameId}/sessions`, { method: "POST" })
        .then((res) => res.json())
        .catch(() => null);
      launchStandaloneGame({ gameUrl, slug, title, token: r?.token });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="btc" className="w-full" onClick={() => setOpen(true)}>
        Crear apuesta 1v1
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-line-2 bg-panel-2 p-6">
            <h3 className="text-lg font-semibold text-ink">Apuesta 1v1</h3>
            <p className="mt-2 text-sm text-muted">
              Las apuestas con sats se crean dentro de {title}: entrá, desafiá a un
              amigo y se genera el contrato de escrow automáticamente. El pozo
              queda retenido hasta que el juego reporte el resultado.
            </p>
            <p className="mt-3 text-xs text-faint">
              Vas a ver el progreso en{" "}
              <span className="text-btc">Apuestas</span> y en{" "}
              <span className="text-blue">Tus apuestas en {title}</span>.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="play" onClick={launch} disabled={loading}>
                {loading ? "Abriendo…" : "Abrir juego y desafiar"}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Ahora no
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
