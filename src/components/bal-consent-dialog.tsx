"use client";

import { useEffect, useState } from "react";
import type { BalConsentDecision, BalConsentRequest } from "nostr-game-protocol/bal";

const PERMISSION_LABELS: Record<string, string> = {
  get_public_key: "Ver tu clave pública",
  nip04_encrypt: "Cifrar mensajes NIP-04",
  nip04_decrypt: "Descifrar mensajes NIP-04",
  nip44_encrypt: "Cifrar mensajes NIP-44",
  nip44_decrypt: "Descifrar mensajes NIP-44",
};

function permissionLabel(permission: string): string {
  if (PERMISSION_LABELS[permission]) return PERMISSION_LABELS[permission];
  if (permission.startsWith("sign_event:")) {
    return `Firmar eventos kind ${permission.slice(11)}`;
  }
  return permission;
}

export function BalConsentDialog({
  request,
  mode,
  onDecision,
  onCancel,
}: {
  request: BalConsentRequest;
  mode: "runtime" | "prelaunch";
  onDecision: (decision: BalConsentDecision) => void;
  onCancel?: () => void;
}) {
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (!onCancel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const identity = `${request.pubkey.slice(0, 12)}…${request.pubkey.slice(-8)}`;
  const prelaunch = mode === "prelaunch";

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bal-title"
    >
      <div className="flex min-h-full items-center justify-center px-4 py-4">
        <div className="w-full max-w-lg rounded-ln-xl border border-ln-luna/45 bg-ln-card p-6 shadow-ln-modal">
          <p className="ln-label">Bunker Auto Login · NIP-46</p>
          <h2 id="bal-title" className="mt-1 font-display text-2xl font-extrabold text-white">
            ¿Usar tu identidad en {request.gameName}?
          </h2>
          <p className="mt-2 text-sm text-ln-muted">
            {prelaunch
              ? "Podés autorizar a Luna Negra antes de abrir el juego y entrar sin volver a esta pestaña."
              : "Luna Negra actuará como firmante remoto. Tu clave privada nunca se enviará al juego."}
          </p>

          <dl className="mt-5 grid gap-3 rounded-ln-lg border border-ln-border bg-ln-bg-deep/55 p-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ln-faint">Juego y origen</dt>
              <dd className="mt-0.5 break-words text-ln-text">
                {request.gameName} · {request.origin}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ln-faint">Identidad</dt>
              <dd className="mt-0.5 font-mono text-xs text-ln-soft">{identity}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ln-faint">Permisos solicitados</dt>
              <dd className="mt-1 max-h-40 overflow-y-auto pr-1">
                <ul className="grid gap-1 text-ln-soft">
                  {request.permissions.map((permission) => (
                    <li key={permission}>• {permissionLabel(permission)}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>

          {prelaunch ? (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-ln-lg border border-ln-border px-3 py-2.5 text-sm text-ln-soft hover:border-ln-luna/45">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-ln-luna"
              />
              <span>
                Recordar para próximos inicios
                <span className="mt-0.5 block text-xs text-ln-faint">
                  Podés revocarlo después desde tu perfil.
                </span>
              </span>
            </label>
          ) : null}

          {prelaunch ? (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="btn btn-aurora"
                data-bal-consent-primary
                onClick={() => onDecision(remember ? "remember" : "once")}
              >
                Dar permiso y jugar
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => onDecision("deny")}>
                Jugar sin permiso
              </button>
              <button type="button" className="btn btn-ghost sm:col-span-2" onClick={onCancel}>
                Cancelar
              </button>
            </div>
          ) : (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="btn btn-luna"
                data-bal-consent-primary
                onClick={() => onDecision("once")}
              >
                Permitir esta vez
              </button>
              <button type="button" className="btn btn-aurora" onClick={() => onDecision("remember")}>
                Permitir y recordar
              </button>
              <button type="button" className="btn btn-ghost sm:col-span-2" onClick={() => onDecision("deny")}>
                No permitir
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
