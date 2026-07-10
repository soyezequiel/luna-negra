"use client";

import { useState } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";

/**
 * "Invitar a jugar" con Luna Room Link (ver docs/luna-room-link.md): genera —sin
 * abrir el juego— un enlace público a una sala HOSTEADA POR EL JUEGO, con el
 * dominio del juego (`<gameUrl>?lnRoom=…`). Cualquiera con el enlace entra; la
 * identidad la resuelve el juego por cold-open contra `/launch/<slug>`.
 *
 * La variante DIRIGIDA (a un `npub`) la soporta el endpoint (`toNpub`); acá
 * exponemos el enlace público, que es el caso de "compartir para jugar".
 */
export function RoomLinkInvite({
  gameId,
  title,
}: {
  gameId: string;
  title: string;
}) {
  const { user, login } = useSession();
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createInvite() {
    if (!user) {
      void login();
      return;
    }
    setState("loading");
    setError(null);
    try {
      const r = await fetch("/api/rooms/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        inviteUrl?: string;
        error?: string;
      };
      if (!r.ok || !d.inviteUrl) {
        setState("error");
        setError(d.error ?? "No se pudo crear el enlace");
        return;
      }
      setInviteUrl(d.inviteUrl);
      setState("ready");
    } catch {
      setState("error");
      setError("No se pudo conectar con Luna Negra.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin clipboard: el usuario copia a mano del input */
    }
  }

  return (
    <div className="rounded-ln-lg border border-ln-luna/30 bg-ln-luna/[0.06] p-4">
      <p className="mb-1 text-sm font-semibold text-ln-text">Jugá con amigos</p>
      <p className="mb-3 text-[13px] text-ln-muted">
        Creá un enlace de sala para {title} y compartilo. Quien lo abra entra
        directo, sin instalar nada.
      </p>

      {state !== "ready" ? (
        <>
          <Button
            variant="luna"
            className="w-full"
            onClick={createInvite}
            disabled={state === "loading"}
          >
            {state === "loading" ? "Creando enlace…" : "🎮 Invitar a jugar"}
          </Button>
          {state === "error" && error ? (
            <p className="mt-2 text-sm text-ln-danger">{error}</p>
          ) : null}
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate rounded-md border border-ln-border bg-ln-bg px-2.5 py-1.5 text-[13px] text-ln-text"
            />
            <Button variant="aurora" size="sm" onClick={copy}>
              {copied ? "¡Copiado!" : "Copiar"}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setState("idle")}
            className="text-[12px] text-ln-faint underline-offset-2 hover:underline"
          >
            Crear otro enlace
          </button>
        </div>
      )}
    </div>
  );
}
