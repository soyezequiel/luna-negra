"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { publishProfile } from "@/lib/nostr-social";

/**
 * Formulario de Lightning Address (lud16) de cobro. Vive en el panel de
 * configuración del perfil (`/profile/editar`). Si se deja vacío, los premios se
 * cobran a la lud16 del perfil Nostr (kind:0) o, si tampoco hay, por QR.
 */
export function Lud16Form({ nostrLud16 }: { nostrLud16: string | null }) {
  const { user, updateUser } = useSession();
  const [value, setValue] = useState(user?.lud16 ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [, startSyncTransition] = useTransition();

  // Sincroniza con el valor de la sesión cuando carga.
  useEffect(() => {
    startSyncTransition(() => {
      setValue(user?.lud16 ?? "");
    });
  }, [user?.lud16, startSyncTransition]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);
    const trimmed = value.trim();
    const normalized = trimmed ? trimmed.toLowerCase() : null;
    try {
      if (!user) throw new Error("No autenticado");
      await publishProfile(user.pubkey, { lud16: normalized ?? undefined });
      const res = await fetch("/api/users/me/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lud16: normalized }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      // Refleja el valor normalizado (minúsculas, o null si quedó vacío) en la
      // sesión, para que el contexto no quede desincronizado con la DB.
      updateUser({ lud16: normalized });
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Error al guardar");
    }
  }

  return (
    <div>
      <p className="text-sm text-ln-muted">
        Dirección donde recibís tus pagos y premios. También se publica en tu
        perfil Nostr para que otros clientes puedan validar el zap
        {nostrLud16 ? (
          <>
            {" "}
            (<span className="font-mono text-ln-text">{nostrLud16}</span>)
          </>
        ) : null}
        . Si la dejás vacía, vas a cobrar escaneando un QR.
      </p>

      <form onSubmit={save} className="mt-4 flex flex-col gap-3">
        <input
          type="text"
          inputMode="email"
          autoComplete="off"
          placeholder="usuario@dominio.com"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setStatus("idle");
          }}
          className="w-full rounded-ln-md border border-ln-border bg-ln-bg-deep px-3 py-2 text-sm text-ln-text placeholder:text-ln-faint focus:outline-none focus:ring-2 focus:ring-ln-corona/40"
        />
        <Button variant="corona" type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Guardando…" : "Guardar"}
        </Button>
      </form>

      {status === "saved" ? (
        <p className="mt-2 text-sm text-ln-aurora">Guardado ✓</p>
      ) : null}
      {status === "error" ? (
        <p className="mt-2 text-sm text-ln-danger">{error}</p>
      ) : null}
    </div>
  );
}
