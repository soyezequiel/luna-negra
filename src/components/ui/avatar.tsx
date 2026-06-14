"use client";

import { useState, type CSSProperties } from "react";
import { hueFromSlug } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Avatar de un usuario Nostr. Si no hay foto —o si la URL existe pero falla al
 * cargar (relay/host caído, 404)— cae a un placeholder con gradiente derivado
 * del nombre, en vez de mostrar el ícono de imagen rota del navegador.
 *
 * `seed` define el color del placeholder (usá el nombre/npub para que sea
 * estable por persona). `className` controla tamaño y forma (ej. "h-8 w-8").
 */
export function Avatar({
  src,
  seed,
  className,
}: {
  src?: string | null;
  seed: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        className={cn("av-gen block rounded-full", className)}
        style={{ "--h": hueFromSlug(seed) } as CSSProperties}
        aria-hidden
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={cn("rounded-full object-cover", className)}
    />
  );
}
