"use client";

import { useEffect, useRef, useState } from "react";
import {
  BalLauncher,
  WebPostMessageTransport,
  type BalConsentDecision,
  type BalConsentRequest,
  type BalNip46Signer,
  type BalTransport,
} from "nostr-game-protocol/bal";
import { useSession } from "@/providers/session-provider";
import { getActiveLocalSignerSource, restoreSigner } from "@/lib/signer";
import { NIP46_RELAYS } from "@/lib/signer-nip46";
import { BalSessionGuard } from "@/lib/bal-session-guard";
import {
  observeBalSignerMessage,
  reportBalAwaitingApproval,
  reportBalConnectionRequested,
  reportBalConsentDecision,
  restoreBalSignerStatus,
  trackBalSignerOperation,
} from "@/lib/bal-signer-status";
import {
  BAL_FOCUS_REQUEST_MESSAGE,
  createLunaBalAuthorizationStore,
  lunaBalGameRegistry,
  matchesRegisteredBalGameWindow,
  notifyBalConsentRequired,
  setActiveBalLauncher,
} from "@/lib/bal-launcher";

const PERMISSION_LABELS: Record<string, string> = {
  get_public_key: "Ver tu clave pública",
  nip04_encrypt: "Cifrar mensajes NIP-04",
  nip04_decrypt: "Descifrar mensajes NIP-04",
  nip44_encrypt: "Cifrar mensajes NIP-44",
  nip44_decrypt: "Descifrar mensajes NIP-44",
};

function permissionLabel(permission: string): string {
  if (PERMISSION_LABELS[permission]) return PERMISSION_LABELS[permission];
  if (permission.startsWith("sign_event:")) return `Firmar eventos kind ${permission.slice(11)}`;
  return permission;
}

/** Listener global del launcher y consentimiento explícito del primer BAL. */
export function BalLauncherHost() {
  const { user } = useSession();
  const userRef = useRef(user);
  const pendingResolve = useRef<((decision: BalConsentDecision) => void) | null>(null);
  const [pending, setPending] = useState<BalConsentRequest | null>(null);

  useEffect(() => { userRef.current = user; }, [user]);

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
      relays: NIP46_RELAYS,
      async getIdentity() {
        const currentUser = userRef.current;
        if (!currentUser) return null;
        const signer = await restoreSigner();
        if (!signer || signer.method !== "local") return null;
        const localSource = getActiveLocalSignerSource();
        const source = currentUser.custodial
          ? "email" as const
          : localSource === "imported"
            ? "nsec" as const
            : null;
        if (!source) return null;
        const trackedSigner: BalNip46Signer = {
          getPublicKey: () => signer.getPublicKey(),
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
          pubkey: currentUser.pubkey,
          source,
          signer: trackedSigner,
        };
      },
      requestConsent(request) {
        // Sólo hay una ventana de consentimiento visible. Una segunda solicitud
        // concurrente se rechaza para evitar clickjacking/confusión de contexto.
        if (pendingResolve.current) return Promise.resolve("deny");
        notifyBalConsentRequired(request.gameId, request.origin);
        reportBalAwaitingApproval(request.gameId, request.gameName);
        setPending(request);
        return new Promise<BalConsentDecision>((resolve) => {
          pendingResolve.current = resolve;
        });
      },
    });
    instance.start();
    setActiveBalLauncher(instance);
    return () => {
      pendingResolve.current?.("deny");
      pendingResolve.current = null;
      setActiveBalLauncher(null);
      instance.stop();
      sessionGuard.stop();
    };
  }, []);

  function decide(decision: BalConsentDecision) {
    reportBalConsentDecision(decision);
    const resolve = pendingResolve.current;
    pendingResolve.current = null;
    setPending(null);
    resolve?.(decision);
  }

  if (!pending) return null;
  const identity = `${pending.pubkey.slice(0, 12)}…${pending.pubkey.slice(-8)}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="bal-title">
      <div className="w-full max-w-lg rounded-ln-xl border border-ln-luna/45 bg-ln-card p-6 shadow-ln-modal">
        <p className="ln-label">Bunker Auto Login · NIP-46</p>
        <h2 id="bal-title" className="mt-1 font-display text-2xl font-extrabold text-white">
          ¿Usar tu identidad en {pending.gameName}?
        </h2>
        <p className="mt-2 text-sm text-ln-muted">
          Luna Negra actuará como firmante remoto. Tu clave privada nunca se enviará al juego.
        </p>

        <dl className="mt-5 grid gap-3 rounded-ln-lg border border-ln-border bg-ln-bg-deep/55 p-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ln-faint">Juego y origen</dt>
            <dd className="mt-0.5 text-ln-text">{pending.gameName} · {pending.origin}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ln-faint">Identidad</dt>
            <dd className="mt-0.5 font-mono text-xs text-ln-soft">{identity}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ln-faint">Permisos solicitados</dt>
            <dd className="mt-1">
              <ul className="grid gap-1 text-ln-soft">
                {pending.permissions.map((permission) => (
                  <li key={permission}>• {permissionLabel(permission)}</li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button type="button" className="btn btn-luna" data-bal-consent-primary onClick={() => decide("once")}>
            Permitir esta vez
          </button>
          <button type="button" className="btn btn-aurora" onClick={() => decide("remember")}>
            Permitir y recordar
          </button>
          <button type="button" className="btn btn-ghost sm:col-span-2" onClick={() => decide("deny")}>
            No permitir
          </button>
        </div>
      </div>
    </div>
  );
}
