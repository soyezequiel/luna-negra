"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { BalConsentDecision, BalConsentRequest } from "nostr-game-protocol/bal";
import { BalConsentDialog } from "@/components/bal-consent-dialog";
import {
  createBalPreauthorizationRequest,
  grantBalPreauthorization,
  hasBalAuthorization,
} from "@/lib/bal-launcher";
import {
  getOpenGameWindow,
  type BalLaunchChoice,
  type BalLaunchContinuation,
  type BalLaunchGame,
} from "@/lib/room-launch";
import {
  getActiveSigner,
  getStoredLocalSignerSource,
  getStoredSignerMethod,
  resolveBalIdentitySource,
} from "@/lib/signer";
import { useAppMode } from "@/providers/app-mode-provider";
import { useSession } from "@/providers/session-provider";

type BalPreauthorizationContextValue = {
  /** Devuelve true cuando dejó un diálogo pendiente; false si continuó ya. */
  requestBalLaunch: (
    game: BalLaunchGame,
    continuation: BalLaunchContinuation,
  ) => boolean;
};

const BalPreauthorizationContext =
  createContext<BalPreauthorizationContextValue | null>(null);

export function BalPreauthorizationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useSession();
  const { mode } = useAppMode();
  const continuationRef = useRef<BalLaunchContinuation | null>(null);
  const [pending, setPending] = useState<BalConsentRequest | null>(null);

  const requestBalLaunch = useCallback((
    game: BalLaunchGame,
    continuation: BalLaunchContinuation,
  ): boolean => {
    if (continuationRef.current) {
      // El diálogo global bloquea una segunda apertura concurrente. Informamos
      // cancelación y `true` para que el caller cierre su pestaña reservada.
      continuation(null, false);
      return true;
    }
    if (mode !== "bal" || !game.balCompatible) {
      continuation(false, false);
      return false;
    }

    // Reconciliar antes de consultar permisos temporales: si la ventana anterior
    // se cerró, getOpenGameWindow elimina el grant de "esta vez" asociado.
    getOpenGameWindow(game.gameId);
    const identitySource = user
      ? resolveBalIdentitySource({
          custodial: Boolean(user.custodial),
          signerMethod: getActiveSigner()?.method ?? getStoredSignerMethod(),
          localSource: getStoredLocalSignerSource(),
        })
      : null;
    const request = user && identitySource
      ? createBalPreauthorizationRequest({
          gameId: game.gameId,
          gameName: game.gameName,
          gameUrl: game.gameUrl,
          identityId: user.id,
          pubkey: user.pubkey,
          identitySource,
          balCompatible: game.balCompatible,
        })
      : null;

    // Sin identidad elegible conservamos el fallback runtime existente. Si el
    // permiso ya está vigente, la apertura sigue dentro del gesto original.
    if (!request || hasBalAuthorization(request)) {
      continuation(true, false);
      return false;
    }

    continuationRef.current = continuation;
    setPending(request);
    return true;
  }, [mode, user]);

  const finish = useCallback((choice: BalLaunchChoice) => {
    const continuation = continuationRef.current;
    continuationRef.current = null;
    setPending(null);
    continuation?.(choice, true);
  }, []);

  function decide(decision: BalConsentDecision) {
    if (!pending) return;
    if (decision !== "deny") {
      grantBalPreauthorization(pending, decision === "remember");
      finish(true);
      return;
    }
    finish(false);
  }

  return (
    <BalPreauthorizationContext.Provider value={{ requestBalLaunch }}>
      {children}
      {pending ? (
        <BalConsentDialog
          request={pending}
          mode="prelaunch"
          onDecision={decide}
          onCancel={() => finish(null)}
        />
      ) : null}
    </BalPreauthorizationContext.Provider>
  );
}

export function useBalPreauthorization(): BalPreauthorizationContextValue {
  const value = useContext(BalPreauthorizationContext);
  if (!value) {
    throw new Error(
      "useBalPreauthorization debe usarse dentro de <BalPreauthorizationProvider>",
    );
  }
  return value;
}
