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
}: {
  form: GameForm;
  setForm: (updater: (prev: GameForm) => GameForm) => void;
  uploadFile: (file: File) => Promise<string | null>;
  uploading: boolean;
}) {
  return (
    <>
      <input
        className={inputCls}
        placeholder="Título"
        value={form.title}
        onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
      />
      <textarea
        className={inputCls}
        placeholder="Descripción"
        rows={3}
        value={form.description}
        onChange={(e) =>
          setForm((prev) => ({ ...prev, description: e.target.value }))
        }
      />
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
    </>
  );
}
