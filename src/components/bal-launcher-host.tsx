"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BalLauncher,
  WebPostMessageTransport,
  type BalConsentDecision,
  type BalConsentRequest,
  type BalNip46Signer,
  type BalTransport,
} from "nostr-game-protocol/bal";
import { useSession } from "@/providers/session-provider";
import { useAppMode } from "@/providers/app-mode-provider";
import {
  getActiveLocalSignerSource,
  matchSignerToSessionUser,
  resolveBalIdentitySource,
  restoreSigner,
} from "@/lib/signer";
import { NIP46_RELAYS } from "@/lib/signer-nip46";
import { BalSessionGuard } from "@/lib/bal-session-guard";
import { BalConsentDialog } from "@/components/bal-consent-dialog";
import {
  observeBalSignerMessage,
  reportBalAwaitingApproval,
  reportBalConnectionRequested,
  reportBalConsentDecision,
  reportBalSessionRestored,
  restoreBalSignerStatus,
  trackBalSignerOperation,
} from "@/lib/bal-signer-status";
import {
  BAL_FOCUS_REQUEST_MESSAGE,
  clearBalSessionAuthorizationsForGame,
  consumeSuppressedBalConsent,
  createLunaBalAuthorizationStore,
  createLunaBalSessionStore,
  lunaBalGameRegistry,
  matchesRegisteredBalGameWindow,
  notifyBalConsentRequired,
  prepareBalLauncherReload,
  rememberBalAuthorizationForSession,
  setActiveBalLauncher,
} from "@/lib/bal-launcher";

/** Listener global del launcher y consentimiento explícito del primer BAL. */
export function BalLauncherHost() {
  const { user, refreshSession } = useSession();
  const { mode } = useAppMode();
  const userRef = useRef(user);
  const pendingResolve = useRef<((decision: BalConsentDecision) => void) | null>(null);
  const [pending, setPending] = useState<BalConsentRequest | null>(null);

  // `getIdentity` vive dentro de un efecto de montaje. El layout effect publica
  // la cuenta nueva antes de que el usuario pueda abrir el juego tras el login.
  useLayoutEffect(() => { userRef.current = user; }, [user]);

  // `window.opener.focus()` no es confiable entre pestañas. El juego pide el
  // foco por el canal permitido de postMessage y Luna lo intenta desde su lado.
  // Si Chrome igual lo bloquea, el título con ⚠ hace identificable la pestaña.
  useEffect(() => {
    if (!pending) return;
    const previousTitle = document.title;
    const pendingTitle = `⚠ Autorizá ${pending.gameName} · Luna Negra`;
    document.title = pendingTitle;

    const handleFocusRequest = (event: MessageEvent) => {
      const message = event.data as { type?: unknown; gameId?: unknown } | null;
      if (
        message?.type !== BAL_FOCUS_REQUEST_MESSAGE
        || message.gameId !== pending.gameId
        || !matchesRegisteredBalGameWindow(
          event.source,
          event.origin,
          pending.gameId,
        )
      ) return;
      try { window.focus(); } catch { /* el navegador puede impedir el cambio */ }
      document.querySelector<HTMLButtonElement>("[data-bal-consent-primary]")
        ?.focus({ preventScroll: true });
    };

    window.addEventListener("message", handleFocusRequest);
    return () => {
      window.removeEventListener("message", handleFocusRequest);
      if (document.title === pendingTitle) document.title = previousTitle;
    };
  }, [pending]);

  useEffect(() => {
    if (mode !== "bal") {
      pendingResolve.current?.("deny");
      pendingResolve.current = null;
      return;
    }
    restoreBalSignerStatus();
    const baseTransport = new WebPostMessageTransport(window);
    const sessionGuard = new BalSessionGuard(window);
    sessionGuard.start();
    const transport: BalTransport<Window> = {
      async send(peer, targetOrigin, message) {
        try {
          await baseTransport.send(peer, targetOrigin, message);
          if (message.type === "BAL_SESSION") {
            sessionGuard.observe(message);
            observeBalSignerMessage(message);
          }
        } finally {
          // revoke/logout cierran localmente la sesión aunque postMessage falle.
          if (message.type === "BAL_LOGOUT") {
            sessionGuard.observe(message);
            observeBalSignerMessage(message);
          }
          if (message.type === "BAL_ERROR") observeBalSignerMessage(message);
        }
      },
      subscribe(handler) {
        return baseTransport.subscribe((envelope) => {
          // El logout iniciado por el juego entra por este lado del transporte.
          sessionGuard.observe(envelope.data);
          observeBalSignerMessage(envelope.data);
          const message = envelope.data as {
            type?: unknown;
            requestId?: unknown;
            gameId?: unknown;
          } | null;
          if (
            message?.type === "BAL_READY"
            && typeof message.requestId === "string"
            && typeof message.gameId === "string"
          ) {
            const game = lunaBalGameRegistry.resolve(envelope, message.gameId);
            if (game) {
              reportBalConnectionRequested(
                message.requestId,
                game.gameId,
                game.gameName,
              );
            }
          }
          handler(envelope);
        });
      },
    };
    const instance = new BalLauncher({
      transport,
      registry: lunaBalGameRegistry,
      authorizationStore: createLunaBalAuthorizationStore(),
      sessionStore: createLunaBalSessionStore(),
      relays: NIP46_RELAYS,
      async getIdentity() {
        const signer = await restoreSigner();
        if (!signer) return null;
        const identity = await matchSignerToSessionUser({
          signer,
          user: userRef.current,
          refreshUser: refreshSession,
        });
        if (!identity) return null;
        const currentUser = identity.user;
        const source = resolveBalIdentitySource({
          custodial: Boolean(currentUser.custodial),
          signerMethod: signer.method,
          localSource: getActiveLocalSignerSource(),
        });
        if (!source) return null;
        const trackedSigner: BalNip46Signer = {
          getPublicKey: async () => identity.pubkey,
          signEvent: (event) => trackBalSignerOperation(
            "signing",
            `Firmando evento kind ${event.kind}`,
            () => signer.signEvent(event),
          ),
          ...(signer.nip04Encrypt ? {
            nip04Encrypt: (peer: string, plaintext: string) => trackBalSignerOperation(
              "encrypting",
              "Cifrando un mensaje NIP-04",
              () => signer.nip04Encrypt!(peer, plaintext),
            ),
          } : {}),
          ...(signer.nip04Decrypt ? {
            nip04Decrypt: (peer: string, ciphertext: string) => trackBalSignerOperation(
              "decrypting",
              "Descifrando un mensaje NIP-04",
              () => signer.nip04Decrypt!(peer, ciphertext),
            ),
          } : {}),
          ...(signer.nip44Encrypt ? {
            nip44Encrypt: (peer: string, plaintext: string) => trackBalSignerOperation(
              "encrypting",
              "Cifrando un mensaje NIP-44",
              () => signer.nip44Encrypt!(peer, plaintext),
            ),
          } : {}),
          ...(signer.nip44Decrypt ? {
            nip44Decrypt: (peer: string, ciphertext: string) => trackBalSignerOperation(
              "decrypting",
              "Descifrando un mensaje NIP-44",
              () => signer.nip44Decrypt!(peer, ciphertext),
            ),
          } : {}),
        };
        return {
          identityId: currentUser.id,
          pubkey: identity.pubkey,
          source,
          signer: trackedSigner,
        };
      },
      requestConsent(request) {
        // Sólo hay una ventana de consentimiento visible. Una segunda solicitud
        // concurrente se rechaza para evitar clickjacking/confusión de contexto.
        if (pendingResolve.current) return Promise.resolve("deny");
        // "Jugar sin permiso" ya fue una decisión explícita en esta pestaña.
        // Consumirla acá evita pedir exactamente lo mismo después de abrir el juego.
        if (consumeSuppressedBalConsent(request)) {
          reportBalConsentDecision("deny");
          return Promise.resolve("deny");
        }
        notifyBalConsentRequired(request.gameId, request.origin);
        reportBalAwaitingApproval(request.gameId, request.gameName);
        setPending(request);
        return new Promise<BalConsentDecision>((resolve) => {
          pendingResolve.current = resolve;
        });
      },
      onSessionClosed(session, reason) {
        if (reason !== "client_logout") return;
        clearBalSessionAuthorizationsForGame(session.gameId);
        observeBalSignerMessage({
          type: "BAL_LOGOUT",
          requestId: session.requestId,
        });
      },
      onSessionRestored(session) {
        reportBalSessionRestored(
          session.requestId,
          session.gameId,
          session.gameName,
          session.expiresAt,
        );
        sessionGuard.observe({
          type: "BAL_SESSION",
          requestId: session.requestId,
          expiresAt: session.expiresAt,
        });
      },
    });
    instance.start();
    setActiveBalLauncher(instance);
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted || !prepareBalLauncherReload()) return;
      // El snapshot queda en sessionStorage; cerrar sockets evita que el remoto
      // viejo y el restaurado respondan a la vez durante la navegación.
      instance.stop({ preserveSessions: true });
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      pendingResolve.current?.("deny");
      pendingResolve.current = null;
      setActiveBalLauncher(null);
      instance.stop();
      sessionGuard.stop();
    };
  }, [mode, refreshSession]);

  function decide(decision: BalConsentDecision) {
    if (decision === "once" && pending) rememberBalAuthorizationForSession(pending);
    reportBalConsentDecision(decision);
    const resolve = pendingResolve.current;
    pendingResolve.current = null;
    setPending(null);
    resolve?.(decision);
  }

  if (!pending || mode !== "bal") return null;
  return <BalConsentDialog request={pending} mode="runtime" onDecision={decide} />;
}
