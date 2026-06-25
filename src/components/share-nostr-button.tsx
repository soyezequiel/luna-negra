"use client";

import { useCallback, useState } from "react";
import { nip19 } from "nostr-tools";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { publishGameShare } from "@/lib/nostr-social";
import type { GameRoot } from "@/lib/nostr-social";

type Props = {
  slug: string;
  title: string;
  /** URL absoluta de la ficha (con preview social). Se arma en el server con SITE_URL. */
  shareUrl: string;
  /** Media del juego (URLs absolutas) que el usuario puede adjuntar a la nota. */
  images?: string[];
  root?: GameRoot | null;
  /** Clases extra para el botón disparador (p. ej. flex-1 en una fila compacta). */
  className?: string;
};

type Phase = "idle" | "composing" | "publishing" | "done" | "error";

const MAX = 280;

// Texto que arranca por defecto: recomendación con contexto, para que enganche
// también a seguidores que todavía no conocen Luna Negra. El usuario lo edita.
const defaultShareText = (title: string) =>
  `Me enganché con «${title}» 🎮 Está en Luna Negra, la tienda de juegos donde entrás con tu identidad Nostr y pagás en sats por Lightning ⚡`;

/**
 * Botón "Compartir en Nostr" de la ficha: publica una nota (kind:1) firmada con
 * la identidad del usuario, con el link a la tienda e imágenes opcionales del
 * juego. Muestra una vista previa en vivo de cómo se vería la nota en un cliente
 * Nostr. Difusión orgánica que trae visitas. Tras publicar, ofrece abrir la nota
 * en njump.
 */
export function ShareNostrButton({
  slug,
  title,
  shareUrl,
  images = [],
  root,
  className,
}: Props) {
  const { user, login } = useSession();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState(() => defaultShareText(title));
  // Imágenes seleccionadas (URLs). Por defecto la primera (carátula) si hay.
  const [selected, setSelected] = useState<string[]>(() =>
    images.length ? [images[0]] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);

  const close = useCallback(() => {
    setPhase("idle");
    setError(null);
    setNoteId(null);
    setText(defaultShareText(title));
    setSelected(images.length ? [images[0]] : []);
  }, [title, images]);

  const toggleImage = useCallback((url: string) => {
    setSelected((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  }, []);

  const submit = useCallback(async () => {
    if (!text.trim()) {
      setError("Escribí algo para compartir.");
      return;
    }
    setError(null);
    setPhase("publishing");
    try {
      const id = await publishGameShare(slug, text, shareUrl, selected, root);
      setNoteId(id);
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "No se pudo publicar la nota.");
    }
  }, [text, slug, shareUrl, selected, root]);

  const njumpUrl = noteId
    ? `https://njump.me/${nip19.noteEncode(noteId)}`
    : null;

  const authorName =
    user?.displayName || (user ? `${user.npub.slice(0, 12)}…` : "Vos");

  return (
    <>
      {user ? (
        <Button
          variant="blue"
          size="sm"
          className={cn("w-full", className)}
          onClick={() => setPhase("composing")}
          title={`Compartí «${title}» en tu feed de Nostr`}
        >
          🌐 Compartir
        </Button>
      ) : (
        <Button
          variant="blue"
          size="sm"
          className={cn("w-full", className)}
          onClick={login}
        >
          🌐 Compartir
        </Button>
      )}

      {phase !== "idle" ? (
        <div className="fixed inset-0 z-[92] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-ln-xl border border-ln-luna/40 bg-ln-card p-6 shadow-ln-modal">
            {phase === "done" ? (
              <div className="text-center">
                <h3 className="font-display text-lg font-bold text-white">
                  ¡Publicado! 🌐
                </h3>
                <p className="mt-2 text-sm text-ln-muted">
                  Tu nota ya está en Nostr. La van a ver tus seguidores.
                </p>
                {njumpUrl ? (
                  <a
                    href={njumpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 block text-sm text-ln-luna-bright hover:underline"
                  >
                    Ver la nota ↗
                  </a>
                ) : null}
                <Button variant="blue" className="mt-5 w-full" onClick={close}>
                  Cerrar
                </Button>
              </div>
            ) : (
              <>
                <h3 className="font-display text-lg font-bold text-white">
                  Compartir en Nostr 🌐
                </h3>
                <p className="mt-1 text-sm text-ln-muted">
                  Editá el texto si querés. El link a la tienda se agrega solo.
                </p>
                <textarea
                  value={text}
                  maxLength={MAX}
                  rows={3}
                  onChange={(e) => setText(e.target.value)}
                  className="mt-3 w-full resize-none rounded-ln-lg border border-ln-border bg-transparent px-3 py-2 text-sm text-ln-text outline-none placeholder:text-ln-faint focus:border-ln-luna/55"
                />
                <div className="mt-1 flex items-center justify-end text-[11px] text-ln-faint">
                  {text.length}/{MAX}
                </div>

                {/* Selector de imágenes del juego para adjuntar */}
                {images.length > 0 ? (
                  <div className="mt-2">
                    <p className="ln-label mb-1.5">Adjuntar imágenes</p>
                    <div className="flex flex-wrap gap-2">
                      {images.map((url) => {
                        const on = selected.includes(url);
                        return (
                          <button
                            key={url}
                            type="button"
                            onClick={() => toggleImage(url)}
                            aria-pressed={on}
                            className={`relative h-14 w-20 overflow-hidden rounded-md border-2 transition ${
                              on
                                ? "border-ln-luna"
                                : "border-ln-border opacity-60 hover:opacity-100"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                            {on ? (
                              <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-ln-luna text-[10px] font-bold text-[#1a1430]">
                                ✓
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Vista previa en vivo: cómo se vería la nota en un cliente Nostr */}
                <p className="ln-label mb-1.5 mt-4">Vista previa</p>
                <div className="rounded-ln-lg border border-ln-border bg-ln-bg-deep/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-ln-border bg-ln-card">
                      {user?.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={user.avatarUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <span className="absolute inset-0 grid place-items-center text-xs font-bold text-ln-faint">
                          {authorName.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ln-text">
                        {authorName}
                      </p>
                      <p className="text-[11px] text-ln-faint">ahora</p>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ln-text">
                    {text}
                  </p>
                  {/* Tarjeta del link a la tienda (lo que verían los seguidores) */}
                  <div className="mt-2 overflow-hidden rounded-md border border-ln-border">
                    {selected.length > 0 ? (
                      <div
                        className={`grid gap-0.5 ${
                          selected.length === 1 ? "grid-cols-1" : "grid-cols-2"
                        }`}
                      >
                        {selected.slice(0, 4).map((url) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={url}
                            src={url}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-28 w-full object-cover"
                          />
                        ))}
                      </div>
                    ) : null}
                    <p className="truncate bg-ln-card px-3 py-2 text-[11px] text-ln-luna-bright">
                      🔗 {shareUrl}
                    </p>
                  </div>
                </div>

                {error ? (
                  <p className="mt-2 text-sm text-[var(--lose)]">{error}</p>
                ) : null}
                <Button
                  variant="blue"
                  className="mt-4 w-full"
                  onClick={submit}
                  disabled={phase === "publishing"}
                >
                  {phase === "publishing" ? "Publicando…" : "Publicar"}
                </Button>
                <button
                  onClick={close}
                  className="mt-3 block w-full text-xs text-faint hover:text-ink"
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
