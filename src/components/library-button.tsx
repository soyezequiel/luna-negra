"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  gameId: string;
  /** ¿Ya está en la biblioteca? true → muestra "Quitar"; false → "Agregar". */
  owned: boolean;
  addLabel?: string;
  removeLabel?: string;
  variant?: "play" | "blue" | "btc" | "luna" | "outline" | "ghost";
  size?: "sm" | "md" | "xl";
  className?: string;
  /** Tras agregar/quitar, refresca la ficha (RSC). Default true. */
  refresh?: boolean;
  /** Callback opcional luego de una operación exitosa (p. ej. refetch local). */
  onDone?: (action: "added" | "removed") => void;
};

// Agrega o quita un juego de la biblioteca (entitlement gratuito). Para juegos
// gratis publicados.
export function LibraryButton({
  gameId,
  owned,
  addLabel = "Agregar a la biblioteca",
  removeLabel = "Quitar de la biblioteca",
  variant = "ghost",
  size = "md",
  className,
  refresh = true,
  onDone,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/games/${gameId}/library`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "No se pudo agregar");
        return;
      }
      onDone?.("added");
      if (refresh) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("¿Quitar este juego de tu biblioteca?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/games/${gameId}/library`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "No se pudo quitar");
        return;
      }
      onDone?.("removed");
      if (refresh) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant={variant}
        size={size}
        className="w-full"
        onClick={owned ? remove : add}
        disabled={busy}
      >
        {busy
          ? owned
            ? "Quitando…"
            : "Agregando…"
          : owned
            ? removeLabel
            : addLabel}
      </Button>
      {error ? (
        <p className="mt-1 text-sm text-[var(--lose)]">{error}</p>
      ) : null}
    </div>
  );
}
