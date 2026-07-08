"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/providers/session-provider";

// Estados de la puerta de cold-open:
//   minting     → pidiendo el entitlement al server.
//   redirecting → token obtenido; saltando de vuelta al juego.
//   needsLogin  → juego pagado sin sesión: hay que iniciar sesión.
//   needsBuy    → sesión OK pero no posee el juego: hay que comprarlo.
//   error       → returnTo inválido o fallo del mint.
type Status = "minting" | "redirecting" | "needsLogin" | "needsBuy" | "error";

/**
 * Puerta cliente del cold-open. Delega el minteo del entitlement al endpoint que
 * ya lo hace (`POST /api/games/:id/sessions`, que cubre invitado en juegos
 * gratis), y al obtener el token redirige a `returnTo` con `lnToken` + `lnOrigin`
 * apendidos (el `lnRoom` ya viaja dentro de `returnTo`).
 */
export function LaunchGate({
  gameId,
  slug,
  title,
  returnTo,
}: {
  gameId: string;
  slug: string;
  title: string;
  /** URL de retorno validada server-side (host == Game.gameUrl), o null si inválida. */
  returnTo: string | null;
}) {
  const { user, login, loading } = useSession();
  const [status, setStatus] = useState<Status>(returnTo ? "minting" : "error");
  const [error, setError] = useState<string | null>(
    returnTo ? null : "El enlace de retorno no es válido.",
  );
  const attempted = useRef(false);

  const attempt = useCallback(async () => {
    if (!returnTo) return;
    setStatus("minting");
    setError(null);
    try {
      const r = await fetch(`/api/games/${gameId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Room Link no es retro-compatible: identidad SIEMPRE por Nostr, nunca lnToken.
        body: JSON.stringify({ roomLink: true }),
      });
      if (r.status === 401) {
        setStatus("needsLogin");
        return;
      }
      if (r.status === 403) {
        setStatus("needsBuy");
        return;
      }
      const d = (await r.json().catch(() => ({}))) as {
        token?: string;
        nostrLogin?: boolean;
        error?: string;
      };
      // Login migrado a Nostr: no hay lnToken; el juego identifica al jugador por
      // NIP-07/46. Redirigimos con el link limpio (solo lnOrigin).
      if (!r.ok || (!d.token && !d.nostrLogin)) {
        setStatus("error");
        setError(d.error ?? "No se pudo generar el acceso.");
        return;
      }
      const url = new URL(returnTo);
      if (d.token) url.searchParams.set("lnToken", d.token);
      url.searchParams.set("lnOrigin", window.location.origin);
      setStatus("redirecting");
      window.location.replace(url.toString());
    } catch {
      setStatus("error");
      setError("No se pudo conectar con Luna Negra.");
    }
  }, [gameId, returnTo]);

  // Primer intento en cuanto sabemos si hay sesión (evita un 401 espurio antes de
  // que la cookie se resuelva).
  useEffect(() => {
    if (loading || attempted.current || !returnTo) return;
    attempted.current = true;
    void attempt();
  }, [loading, attempt, returnTo]);

  // Reintento automático apenas el usuario inicia sesión.
  useEffect(() => {
    if (user && status === "needsLogin") void attempt();
  }, [user, status, attempt]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-12 text-center">
      <div className="w-full rounded-ln-lg border border-ln-corona/40 bg-ln-card p-6 shadow-ln-corona">
        <p className="ln-label mb-1">Entrando a la sala</p>
        <h1 className="mb-4 font-display text-2xl font-extrabold text-white">
          {title}
        </h1>

        {(status === "minting" || status === "redirecting") && (
          <p className="text-sm text-ln-muted">
            {status === "redirecting"
              ? "Listo, abriendo el juego…"
              : "Verificando tu acceso…"}
          </p>
        )}

        {status === "needsLogin" && (
          <div className="space-y-3">
            <p className="text-sm text-ln-muted">
              Iniciá sesión con Nostr para entrar a la sala.
            </p>
            <button
              type="button"
              onClick={() => void login()}
              className="btn btn-aurora w-full"
            >
              Conectar con Nostr
            </button>
          </div>
        )}

        {status === "needsBuy" && (
          <div className="space-y-3">
            <p className="text-sm text-ln-muted">
              Necesitás tener este juego para entrar a la sala.
            </p>
            <Link href={`/game/${slug}?view=store`} className="btn btn-aurora w-full">
              Ver en la tienda
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-3">
            <p className="text-sm text-ln-danger">
              {error ?? "No se pudo abrir la sala."}
            </p>
            <Link href={`/game/${slug}`} className="btn btn-ghost w-full">
              Ir a la ficha del juego
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
