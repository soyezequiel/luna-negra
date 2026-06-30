"use client";

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
  coverUrl: string;
  horizontalCoverUrl: string;
  screenshots: string[];
  videos: string[];
  // Override del corte del dev en apuestas para este juego. "" = usar el default
  // del proveedor. Se acota al tope global del admin al guardar.
  betDevFeePct: string;
  // Juego en beta: solo lo ven en la tienda quienes activaron "ver juegos beta"
  // en su perfil (más el dueño y el admin).
  isBeta: boolean;
};

export const emptyForm: GameForm = {
  title: "",
  description: "",
  categories: [],
  priceSats: "0",
  gameUrl: "",
  coverUrl: "",
  horizontalCoverUrl: "",
  screenshots: [],
  videos: [],
  betDevFeePct: "",
  isBeta: false,
};

export function parseShots(json: string): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function GameFormFields({
  form,
  setForm,
  uploadFile,
  uploading,
  devFeeDefault = 0,
}: {
  form: GameForm;
  setForm: (updater: (prev: GameForm) => GameForm) => void;
  uploadFile: (file: File) => Promise<string | null>;
  uploading: boolean;
  /** Corte del dev por defecto del proveedor; se muestra como placeholder/hereda. */
  devFeeDefault?: number;
}) {
  return (
    <>
      <input
        className={inputCls}
        placeholder="Título"
        value={form.title}
        onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
      />
      <div>
        <textarea
          className={`${inputCls} font-mono text-xs`}
          placeholder="Descripción — texto plano o HTML enriquecido (encabezados, listas, imágenes, tablas, vídeos de YouTube/Vimeo…)"
          rows={5}
          value={form.description}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, description: e.target.value }))
          }
        />
        <div className="mt-1.5 flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-ink hover:bg-white/5">
            📄 Subir .html
            <input
              type="file"
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
          <span className="text-[11px] text-ln-faint">
            El HTML se sanea al guardar; scripts y estilos peligrosos se eliminan.
          </span>
        </div>
      </div>
      <div>
        <label className="block text-sm text-muted">Precio (sats)</label>
        <input
          className={`${inputCls} mt-1`}
          type="number"
          min={0}
          placeholder="0 = gratis"
          value={form.priceSats}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, priceSats: e.target.value }))
          }
        />
      </div>
      <div>
        <label className="block text-sm text-muted">
          Mi corte de apuestas para este juego (%){" "}
          <span className="text-ln-faint">(vacío = usar mi default)</span>
        </label>
        <input
          className={`${inputCls} mt-1`}
          type="number"
          min={0}
          max={100}
          placeholder={`${devFeeDefault} (mi default)`}
          value={form.betDevFeePct}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, betDevFeePct: e.target.value }))
          }
        />
        <p className="mt-1 text-[11px] text-ln-faint">
          Porcentaje del pozo que te llevás al liquidar apuestas de este juego. Se
          acota al tope que fija Luna Negra.
        </p>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-ln-md border border-ln-border bg-ln-bg-deep/40 p-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-ln-luna"
          checked={form.isBeta}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, isBeta: e.target.checked }))
          }
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ln-text">
            Marcar como beta
          </span>
          <span className="mt-0.5 block text-[11px] text-ln-faint">
            En la tienda solo lo verán quienes activaron “ver juegos beta” en su
            perfil (vos y el admin lo ven siempre). Se puede activar y desactivar
            sin re-publicar.
          </span>
        </span>
      </label>
      <div>
        <label className="block text-sm text-muted">
          Categorías <span className="text-ln-faint">(podés elegir varias)</span>
        </label>
        <div className="mt-1.5 flex flex-wrap gap-2">
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
      </div>
      <input
        className={inputCls}
        placeholder="URL del juego (subdominio)"
        value={form.gameUrl}
        onChange={(e) =>
          setForm((prev) => ({ ...prev, gameUrl: e.target.value }))
        }
      />

      {/* Portada vertical */}
      <div>
        <label className="block text-sm text-muted">Portada vertical</label>
        <div className="mt-1 flex items-center gap-3">
          {form.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.coverUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-16 w-12 rounded object-cover"
            />
          ) : null}
          <input
            className={inputCls}
            placeholder="Pegá una URL de portada…"
            value={form.coverUrl}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, coverUrl: e.target.value }))
            }
          />
        </div>
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-ink hover:bg-white/5">
          {uploading ? "Subiendo…" : "📷 Subir portada"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const url = await uploadFile(f);
              if (url) setForm((prev) => ({ ...prev, coverUrl: url }));
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* Portada horizontal */}
      <div>
        <label className="block text-sm text-muted">Portada horizontal</label>
        <div className="mt-1 space-y-2">
          {form.horizontalCoverUrl ? (
            <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.horizontalCoverUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          ) : null}
          <input
            className={inputCls}
            placeholder="Pega una URL de portada horizontal..."
            value={form.horizontalCoverUrl}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                horizontalCoverUrl: e.target.value,
              }))
            }
          />
        </div>
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-ink hover:bg-white/5">
          {uploading ? "Subiendo..." : "Subir portada horizontal"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const url = await uploadFile(f);
              if (url)
                setForm((prev) => ({ ...prev, horizontalCoverUrl: url }));
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* Capturas */}
      <div>
        <label className="block text-sm text-muted">Capturas</label>
        {form.screenshots.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {form.screenshots.map((src, i) => (
              <div key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-16 w-16 rounded object-cover"
                />
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      screenshots: prev.screenshots.filter((_, j) => j !== i),
                    }))
                  }
                  className="absolute -right-1 -top-1 rounded-full bg-black/80 px-1.5 text-xs leading-tight"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-ink hover:bg-white/5">
          {uploading ? "Subiendo…" : "➕ Agregar captura"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const url = await uploadFile(f);
              if (url)
                setForm((prev) => ({
                  ...prev,
                  screenshots: [...prev.screenshots, url],
                }));
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* Videos (trailers, estilo Steam: se muestran primero en la galería) */}
      <div>
        <label className="block text-sm text-muted">
          Videos <span className="text-ln-faint">(MP4 o WebM · van primero en la galería)</span>
        </label>
        {form.videos.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {form.videos.map((src, i) => (
              <div key={src} className="relative">
                <video
                  src={src}
                  muted
                  preload="metadata"
                  className="h-16 w-28 rounded bg-black object-cover"
                />
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      videos: prev.videos.filter((_, j) => j !== i),
                    }))
                  }
                  className="absolute -right-1 -top-1 rounded-full bg-black/80 px-1.5 text-xs leading-tight"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-ink hover:bg-white/5">
          {uploading ? "Subiendo…" : "🎬 Agregar video"}
          <input
            type="file"
            accept="video/mp4,video/webm,.mp4,.webm"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const url = await uploadFile(f);
              if (url)
                setForm((prev) => ({
                  ...prev,
                  videos: [...prev.videos, url],
                }));
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </>
  );
}
