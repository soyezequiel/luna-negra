"use client";

import { useId, useState, type ReactNode } from "react";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";

export const inputCls =
  "w-full rounded-ln-md border border-ln-border bg-ln-bg-deep px-3 py-2 text-sm text-ln-text outline-none transition-shadow placeholder:text-ln-faint focus:ring-2 focus:ring-ln-luna/25";

export type GameForm = {
  title: string;
  description: string;
  categories: string[];
  priceSats: string;
  gameUrl: string;
  balCompatible: boolean;
  coverUrl: string;
  horizontalCoverUrl: string;
  screenshots: string[];
  videos: string[];
  // Override del corte del dev en apuestas para este juego. "" = usar el default
  // del proveedor. Se acota al tope global del admin al guardar.
  betDevFeePct: string;
};

export const emptyForm: GameForm = {
  title: "",
  description: "",
  categories: [],
  priceSats: "0",
  gameUrl: "",
  balCompatible: false,
  coverUrl: "",
  horizontalCoverUrl: "",
  screenshots: [],
  videos: [],
  betDevFeePct: "",
};

export function parseShots(json: string): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

type GameFormMode = "create" | "edit";

function FieldBlock({
  id,
  label,
  hint,
  required,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5">
        <label
          htmlFor={id}
          className="text-sm font-semibold leading-5 text-ln-soft"
        >
          {label}
          {required ? (
            <span
              aria-hidden="true"
              className="ml-2 rounded-full bg-ln-luna/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-ln-luna"
            >
              Obligatorio
            </span>
          ) : null}
        </label>
        {hint ? (
          <p className="mt-1 text-[11.5px] leading-relaxed text-ln-faint">
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function InfoTooltip({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        aria-label="¿Qué es BAL?"
        aria-describedby={id}
        className="grid h-5 w-5 place-items-center rounded-full border border-ln-border text-[11px] font-bold text-ln-muted outline-none transition-colors hover:border-ln-luna/50 hover:text-ln-luna focus-visible:ring-2 focus-visible:ring-ln-luna/35"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 w-72 max-w-[calc(100vw-3rem)] rounded-ln-md border border-ln-border bg-ln-bg-deep px-3 py-2.5 text-left text-[11.5px] font-normal leading-relaxed text-ln-soft opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

function ProgressiveSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group border-t border-ln-border pt-4"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ln-text">
            {title}
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ln-faint">
            {summary}
          </span>
        </span>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-ln-border text-ln-muted transition-colors group-hover:text-ln-text">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={cn(
              "h-4 w-4 transition-transform",
              open && "rotate-180",
            )}
          >
            <path
              d="m6 9 6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </span>
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}

function DraftReadiness({ form }: { form: GameForm }) {
  const items = [
    { label: "Título", done: form.title.trim().length > 0, required: true },
    { label: "URL del juego", done: form.gameUrl.trim().length > 0 },
    { label: "Categoría", done: form.categories.length > 0 },
    { label: "Descripción", done: form.description.trim().length > 0 },
    {
      label: "Portada",
      done:
        form.coverUrl.trim().length > 0 ||
        form.horizontalCoverUrl.trim().length > 0,
    },
  ];

  return (
    <div className="border-y border-ln-border bg-ln-bg-deep/30 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-ln-text">
            Primero creás un borrador privado.
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ln-faint">
            Solo el título es obligatorio ahora. Lo demás ayuda a dejarlo listo
            para revisión.
          </p>
        </div>
        <span className="w-fit rounded-full border border-ln-border px-2.5 py-1 text-[10.5px] font-semibold uppercase text-ln-muted">
          No visible en tienda
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item.label}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]",
              item.done
                ? "border-ln-aurora/30 bg-ln-aurora/10 text-ln-aurora-bright"
                : item.required
                  ? "border-ln-luna/30 bg-ln-luna/10 text-ln-luna"
                  : "border-ln-border text-ln-faint",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                item.done ? "bg-ln-aurora" : "bg-ln-faint",
              )}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function UploadPill({
  label,
  uploading,
  accept,
  onFile,
}: {
  label: string;
  uploading: boolean;
  accept: string;
  onFile: (file: File) => Promise<void> | void;
}) {
  return (
    <label
      className={cn(
        "mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-ln-text hover:bg-white/5",
        uploading && "pointer-events-none opacity-60",
      )}
    >
      {uploading ? "Subiendo..." : label}
      <input
        type="file"
        name={`upload-${label.toLowerCase().replaceAll(" ", "-")}`}
        aria-label={label}
        accept={accept}
        disabled={uploading}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          await onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function RemoveMediaButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/80 text-xs leading-none text-white ring-1 ring-white/20"
      aria-label="Quitar archivo"
    >
      x
    </button>
  );
}

export function GameFormFields({
  form,
  setForm,
  uploadFile,
  uploading,
  devFeeDefault = 0,
  mode = "edit",
}: {
  form: GameForm;
  setForm: (updater: (prev: GameForm) => GameForm) => void;
  uploadFile: (file: File) => Promise<string | null>;
  uploading: boolean;
  /** Corte del dev por defecto del proveedor; se muestra como placeholder/hereda. */
  devFeeDefault?: number;
  mode?: GameFormMode;
}) {
  const rawId = useId();
  const idBase = `game-form-${rawId.replace(/:/g, "")}`;
  const defaultOpen = mode === "edit";

  return (
    <div className="space-y-5">
      {mode === "create" ? <DraftReadiness form={form} /> : null}

      <section className="space-y-4">
        <div>
          <p className="ln-label mb-2">Datos básicos</p>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(180px,0.55fr)]">
            <FieldBlock
              id={`${idBase}-title`}
              label="Título del juego"
              hint="Usalo como aparecerá en la tienda."
              required
            >
              <input
                id={`${idBase}-title`}
                className={inputCls}
                placeholder="Ej. Neon Dungeon"
                required
                value={form.title}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }
              />
            </FieldBlock>

            <FieldBlock
              id={`${idBase}-price`}
              label="Precio"
              hint="0 lo publica como gratis."
            >
              <input
                id={`${idBase}-price`}
                className={inputCls}
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="0"
                value={form.priceSats}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, priceSats: e.target.value }))
                }
              />
            </FieldBlock>
          </div>
        </div>

        <FieldBlock
          id={`${idBase}-game-url`}
          label="URL donde corre"
          hint="Puede quedar vacía mientras preparás el borrador."
        >
          <input
            id={`${idBase}-game-url`}
            className={inputCls}
            placeholder="https://tu-juego.com"
            value={form.gameUrl}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, gameUrl: e.target.value }))
            }
          />
        </FieldBlock>

        <div className="rounded-ln-md border border-ln-border bg-ln-bg-deep/55 p-3.5">
          <div className="flex items-start justify-between gap-4">
            <label
              htmlFor={`${idBase}-bal-compatible`}
              className="flex min-w-0 cursor-pointer items-start gap-3"
            >
              <input
                id={`${idBase}-bal-compatible`}
                type="checkbox"
                className="peer sr-only"
                checked={form.balCompatible}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    balCompatible: e.target.checked,
                  }))
                }
              />
              <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full border border-ln-border bg-ln-bg transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-ln-muted after:transition-transform peer-checked:border-ln-aurora/50 peer-checked:bg-ln-aurora/20 peer-checked:after:translate-x-4 peer-checked:after:bg-ln-aurora peer-focus-visible:ring-2 peer-focus-visible:ring-ln-luna/35" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ln-soft">
                  Compatible con BAL
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ln-faint">
                  Luna ofrecerá identidad y permisos antes de abrir el juego.
                </span>
              </span>
            </label>
            <InfoTooltip id={`${idBase}-bal-tooltip`}>
              BAL (Bunker Auto Login) conecta la identidad Nostr del jugador con
              el juego mediante NIP-46, sin compartir su clave privada. Activá
              esta opción sólo si integraste el flujo BAL del SDK de Nostr Games
              Protocol; Luna validará además la ventana y el origen exacto del
              juego.
            </InfoTooltip>
          </div>
        </div>

      </section>

      <ProgressiveSection
        title="Ficha de tienda"
        summary="Categorías, pitch, controles, requisitos o HTML enriquecido."
        defaultOpen={defaultOpen}
      >
        <FieldBlock
          label="Categorías"
          hint="Elegir pocas categorías hace que la ficha sea más fácil de encontrar."
        >
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const on = form.categories.includes(c.slug);
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      categories: on
                        ? prev.categories.filter((s) => s !== c.slug)
                        : [...prev.categories, c.slug],
                    }))
                  }
                  className={cn("chip", on && "chip-on")}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </FieldBlock>

        <FieldBlock
          id={`${idBase}-description`}
          label="Descripción"
          hint="Podés escribir texto simple o pegar HTML saneado al guardar."
        >
          <textarea
            id={`${idBase}-description`}
            className={`${inputCls} font-mono text-xs`}
            placeholder="Contá de qué trata, cómo se juega y qué tiene de especial."
            rows={6}
            value={form.description}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, description: e.target.value }))
            }
          />
        </FieldBlock>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-ln-text hover:bg-white/5">
            Subir .html
            <input
              type="file"
              id={`${idBase}-description-html`}
              name="descriptionHtml"
              aria-label="Subir HTML"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                setForm((prev) => ({ ...prev, description: text }));
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-[11px] leading-relaxed text-ln-faint">
            Scripts y estilos peligrosos se eliminan al guardar.
          </span>
        </div>
      </ProgressiveSection>

      <ProgressiveSection
        title="Imágenes y video"
        summary="Portadas, capturas y trailers para que la ficha se entienda rápido."
        defaultOpen={defaultOpen}
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <FieldBlock
            id={`${idBase}-cover`}
            label="Portada vertical"
            hint="Se usa en tarjetas y listados."
          >
            <div className="flex items-center gap-3">
              {form.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.coverUrl}
                  alt="Vista previa de portada vertical"
                  referrerPolicy="no-referrer"
                  className="h-20 w-14 shrink-0 rounded object-cover"
                />
              ) : null}
              <input
                id={`${idBase}-cover`}
                className={inputCls}
                placeholder="https://..."
                value={form.coverUrl}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, coverUrl: e.target.value }))
                }
              />
            </div>
            <UploadPill
              label="Subir portada"
              uploading={uploading}
              accept="image/*"
              onFile={async (file) => {
                const url = await uploadFile(file);
                if (url) setForm((prev) => ({ ...prev, coverUrl: url }));
              }}
            />
          </FieldBlock>

          <FieldBlock
            id={`${idBase}-horizontal-cover`}
            label="Portada horizontal"
            hint="Se usa en cabeceras y galerías."
          >
            <div className="space-y-2">
              {form.horizontalCoverUrl ? (
                <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.horizontalCoverUrl}
                    alt="Vista previa de portada horizontal"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              ) : null}
              <input
                id={`${idBase}-horizontal-cover`}
                className={inputCls}
                placeholder="https://..."
                value={form.horizontalCoverUrl}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    horizontalCoverUrl: e.target.value,
                  }))
                }
              />
            </div>
            <UploadPill
              label="Subir portada horizontal"
              uploading={uploading}
              accept="image/*"
              onFile={async (file) => {
                const url = await uploadFile(file);
                if (url) {
                  setForm((prev) => ({ ...prev, horizontalCoverUrl: url }));
                }
              }}
            />
          </FieldBlock>
        </div>

        <FieldBlock
          label="Capturas"
          hint="Agregá pantallas concretas del juego; podés reordenarlas después editando la ficha."
        >
          {form.screenshots.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {form.screenshots.map((src, i) => (
                <div key={src} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt="Captura del juego"
                    referrerPolicy="no-referrer"
                    className="h-16 w-16 rounded object-cover"
                  />
                  <RemoveMediaButton
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        screenshots: prev.screenshots.filter(
                          (_, j) => j !== i,
                        ),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
          <UploadPill
            label="Agregar captura"
            uploading={uploading}
            accept="image/*"
            onFile={async (file) => {
              const url = await uploadFile(file);
              if (url) {
                setForm((prev) => ({
                  ...prev,
                  screenshots: [...prev.screenshots, url],
                }));
              }
            }}
          />
        </FieldBlock>

        <FieldBlock
          label="Videos"
          hint="MP4 o WebM. Se muestran primero en la galería."
        >
          {form.videos.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {form.videos.map((src, i) => (
                <div key={src} className="relative">
                  <video
                    src={src}
                    muted
                    preload="metadata"
                    className="h-16 w-28 rounded bg-black object-cover"
                  />
                  <RemoveMediaButton
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        videos: prev.videos.filter((_, j) => j !== i),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
          <UploadPill
            label="Agregar video"
            uploading={uploading}
            accept="video/mp4,video/webm,.mp4,.webm"
            onFile={async (file) => {
              const url = await uploadFile(file);
              if (url) {
                setForm((prev) => ({
                  ...prev,
                  videos: [...prev.videos, url],
                }));
              }
            }}
          />
        </FieldBlock>
      </ProgressiveSection>

      <ProgressiveSection
        title="Opciones avanzadas"
        summary="Corte especial de apuestas. Normalmente podés dejarlo como está."
        defaultOpen={defaultOpen}
      >
        <FieldBlock
          id={`${idBase}-bet-fee`}
          label="Mi corte de apuestas para este juego"
          hint="Vacío hereda tu default de proveedor. Luna Negra aplica el tope global al guardar."
        >
          <div className="flex items-center gap-2">
            <input
              id={`${idBase}-bet-fee`}
              className={cn(inputCls, "max-w-[160px]")}
              type="number"
              min={0}
              max={100}
              placeholder={`${devFeeDefault}`}
              value={form.betDevFeePct}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  betDevFeePct: e.target.value,
                }))
              }
            />
            <span className="text-sm text-ln-faint">%</span>
          </div>
        </FieldBlock>
      </ProgressiveSection>
    </div>
  );
}
