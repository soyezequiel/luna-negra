"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function PlayButton({
  gameId,
  gameUrl,
  className,
}: {
  gameId: string;
  gameUrl: string;
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
