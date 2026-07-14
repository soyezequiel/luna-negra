"use client";

import { useState } from "react";
import type { BalConsentRequest } from "nostr-game-protocol/bal";
import { BalConsentDialog } from "@/components/bal-consent-dialog";
import { Button } from "@/components/ui/button";
import { useNotify } from "@/providers/notifications-provider";
import { useSession } from "@/providers/session-provider";
import {
  clearSuppressedBalConsent,
  createBalPreauthorizationRequest,
  grantBalPreauthorization,
  hasBalAuthorization,
  suppressNextBalConsent,
} from "@/lib/bal-launcher";
import {
  getActiveSigner,
  getStoredLocalSignerSource,
  getStoredSignerMethod,
  resolveBalIdentitySource,
} from "@/lib/signer";
import {
  getOpenGameWindow,
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
  const [preauthorization, setPreauthorization] = useState<BalConsentRequest | null>(null);
  const { notify } = useNotify();
  const { user } = useSession();

  function getPreauthorizationRequest(): BalConsentRequest | null {
    if (!slug || !user) return null;
    const identitySource = resolveBalIdentitySource({
      custodial: Boolean(user.custodial),
      signerMethod: getActiveSigner()?.method ?? getStoredSignerMethod(),
      localSource: getStoredLocalSignerSource(),
    });
    if (!identitySource) return null;
    return createBalPreauthorizationRequest({
      gameId: slug,
      gameName: title ?? slug,
      gameUrl,
      identityId: user.id,
      pubkey: user.pubkey,
      identitySource,
    });
  }

  async function openGame(suppressedRequest?: BalConsentRequest) {
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
      });
      if (!result.ok) {
        if (suppressedRequest) clearSuppressedBalConsent(suppressedRequest);
        notify({
          title: POPUP_BLOCKED_TITLE,
          body: POPUP_BLOCKED_BODY,
          href: result.dest,
          kind: "warn",
          actionLabel: "Abrir juego",
        });
      }
    } catch {
      if (suppressedRequest) clearSuppressedBalConsent(suppressedRequest);
      win?.close();
    } finally {
      setLoading(false);
    }
  }

  function play() {
    if (loading) return;
    // Reconciliar la ventana ANTES de mirar el permiso temporal. Si el usuario
    // cerró el juego y vuelve a abrirlo antes de que corra el watcher, esta
    // lectura detecta `closed`, desregistra BAL y elimina "Permitir esta vez".
    const gameAlreadyOpen = slug ? getOpenGameWindow(slug) !== null : false;
    const request = getPreauthorizationRequest();
    if (!gameAlreadyOpen && request && !hasBalAuthorization(request)) {
      setPreauthorization(request);
      return;
    }
    void openGame();
  }

  function decidePreauthorization(decision: "once" | "remember" | "deny") {
    const request = preauthorization;
    if (!request) return;
    setPreauthorization(null);
    if (decision === "deny") {
      suppressNextBalConsent(request);
      void openGame(request);
      return;
    }
    grantBalPreauthorization(request, decision === "remember");
    void openGame();
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={play}
        disabled={loading}
      >
        {loading ? "Abriendo…" : label}
      </Button>
      {preauthorization ? (
        <BalConsentDialog
          request={preauthorization}
          mode="prelaunch"
          onDecision={decidePreauthorization}
          onCancel={() => setPreauthorization(null)}
        />
      ) : null}
    </>
  );
}
