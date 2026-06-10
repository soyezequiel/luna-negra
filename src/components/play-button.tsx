"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { launchStandaloneGame } from "@/lib/room-launch";

export function PlayButton({
  gameId,
  gameUrl,
  title,
  slug,
  className,
  label = "Jugar",
  variant = "play",
  size = "md",
}: {
  gameId: string;
  gameUrl: string;
  title?: string;
  slug?: string;
  className?: string;
  label?: string;
  variant?: "play" | "blue" | "btc" | "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "xl";
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
      launchStandaloneGame({ gameUrl, slug, title, token: r?.token });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={play}
      disabled={loading}
    >
      {loading ? "Abriendo…" : label}
    </Button>
  );
}
