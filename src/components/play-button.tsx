"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { publishPlayingStatus } from "@/lib/nostr-social";

export function PlayButton({
  gameId,
  gameUrl,
  title,
  slug,
  className,
}: {
  gameId: string;
  gameUrl: string;
  title?: string;
  slug?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function play() {
    setLoading(true);
    try {
      const r = await fetch(`/api/games/${gameId}/play-token`, {
        method: "POST",
      })
        .then((res) => res.json())
        .catch(() => null);
      const url = new URL(gameUrl, window.location.origin);
      if (r?.token) url.searchParams.set("lnToken", r.token);
      window.open(url.toString(), "_blank", "noopener");
      // Presencia NIP-38 "jugando X" (best-effort, no bloquea el lanzamiento).
      if (title) {
        const link = slug
          ? new URL(`/game/${slug}`, window.location.origin).toString()
          : undefined;
        publishPlayingStatus(title, link).catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button className={className} onClick={play} disabled={loading}>
      {loading ? "Abriendo…" : "Jugar"}
    </Button>
  );
}
