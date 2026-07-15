"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/providers/notifications-provider";
import { useBalPreauthorization } from "@/providers/bal-preauthorization-provider";
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
  balCompatible = false,
  className,
  label = "Jugar",
  variant = "play",
  size = "md",
}: {
  gameId: string;
  gameUrl: string;
  title?: string;
  slug?: string;
  balCompatible?: boolean;
  className?: string;
  label?: string;
  variant?: "play" | "blue" | "btc" | "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "xl";
}) {
  const [loading, setLoading] = useState(false);
  const { notify } = useNotify();
  const { requestBalLaunch } = useBalPreauthorization();

  async function openGame(balEnabled: boolean) {
    if (loading) return;
    // Pre-abrir la pestaña DENTRO del gesto del click: después del await, Brave
    // y otros bloqueadores de popups rechazan el window.open.
    const win = slug
      ? preopenGameWindowIfNeeded(slug)
      : window.open("", "_blank");
    setLoading(true);
    try {
      // Verifica el acceso y registra el "play" (best-effort). La identidad la
      // resuelve el juego por Nostr (NIP-07/46); no se mintea token de identidad.
      await fetch(`/api/games/${gameId}/sessions`, { method: "POST" }).catch(
        () => null,
      );
      const result = launchStandaloneGame({
        gameUrl,
        slug,
        title,
        win,
        balEnabled,
        balCompatible,
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

  function play() {
    if (loading) return;
    requestBalLaunch(
      {
        gameId: slug ?? gameId,
        gameName: title ?? slug ?? gameId,
        gameUrl,
        balCompatible: balCompatible && Boolean(slug),
      },
      (choice) => {
        if (choice !== null) void openGame(choice);
      },
    );
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
