"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { startPlayingPresence } from "@/lib/playing-presence";

export function PlayButton({
  gameId,
  gameUrl,
  title,
  slug,
  className,
  label = "Jugar",
}: {
  gameId: string;
  gameUrl: string;
  title?: string;
  slug?: string;
  className?: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function play() {
    setLoading(true);
    try {
      const r = await fetch(`/api/games/${gameId}/sessions`, {
        method: "POST",
      })
        .then((res) => res.json())
        .catch(() => null);
      const url = new URL(gameUrl, window.location.origin);
      if (r?.token) url.searchParams.set("lnToken", r.token);
      window.open(url.toString(), "_blank", "noopener");
      // Presencia NIP-38 "jugando X": la tienda la deriva de la presencia que el
      // juego reporta a la API (ver playing-presence.ts). El juego no toca Nostr.
      if (title) {
        const link = slug
          ? new URL(`/game/${slug}`, window.location.origin).toString()
          : undefined;
        startPlayingPresence({ title, link });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button className={className} onClick={play} disabled={loading}>
      {loading ? "Abriendo…" : label}
    </Button>
  );
}
