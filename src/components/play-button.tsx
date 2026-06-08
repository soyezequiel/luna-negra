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
      // Sin `noopener`: el juego le late a su opener para mantener viva la
      // presencia NIP-38 (ver playing-presence.ts).
      const win = window.open(url.toString(), "_blank");
      // Presencia NIP-38 "jugando X" gobernada por el heartbeat del juego.
      if (title && win) {
        const link = slug
          ? new URL(`/game/${slug}`, window.location.origin).toString()
          : undefined;
        startPlayingPresence({ win, title, link });
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
