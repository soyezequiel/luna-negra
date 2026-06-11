"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/providers/notifications-provider";
import {
  launchStandaloneGame,
  preopenGameWindowIfNeeded,
  POPUP_BLOCKED_BODY,
  POPUP_BLOCKED_TITLE,
} from "@/lib/room-launch";

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
  const { notify } = useNotify();

  async function play() {
    if (loading) return;
    // Pre-abrir la pestaña DENTRO del gesto del click: después del await, Brave
    // y otros bloqueadores de popups rechazan el window.open.
    const win = slug
      ? preopenGameWindowIfNeeded(slug)
      : window.open("", "_blank");
    setLoading(true);
    try {
      const r = await fetch(`/api/games/${gameId}/sessions`, {
        method: "POST",
      })
        .then((res) => res.json())
        .catch(() => null);
      const result = launchStandaloneGame({
        gameUrl,
        slug,
        title,
        token: r?.token,
        win,
      });
      if (!result.ok) {
        notify({
          title: POPUP_BLOCKED_TITLE,
          body: POPUP_BLOCKED_BODY,
          href: result.dest,
          kind: "warn",
          actionLabel: "Abrir juego",
        });
      }
    } catch {
      win?.close();
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
