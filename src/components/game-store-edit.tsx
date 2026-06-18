"use client";

import {
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/components/provider/game-form-fields";
import { CATEGORIES, categoryLabel } from "@/lib/categories";
import { priceLabel } from "@/lib/format";
import { parseScreenshotUrls } from "@/lib/game-media";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Infra compartida                                                    */
/* ------------------------------------------------------------------ */

/** Guarda un parche parcial del juego vía la ruta que ya valida dueño + campos. */
function usePatchGame(gameId: string) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (data: Record<string, unknown>): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        const r = await fetch(`/api/provider/games/${gameId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(d.error ?? "No se pudieron guardar los cambios");
          return false;
        }
        router.refresh();
        return true;
      } finally {
        setSaving(false);
      }
    },
    [gameId, router],
  );

  return { save, saving, error, setError };
}

function PencilButton({
  onClick,
  label = "Editar",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-ln-border p-1.5 text-ln-muted opacity-70 transition-colors hover:bg-white/5 hover:text-ln-text hover:opacity-100"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    </button>
  );
}

function EditBar({
  saving,
  error,
  onCancel,
}: {
  saving: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? "Guardando…" : "Guardar"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
        Cancelar
      </Button>
      {error ? <span className="text-xs text-[var(--lose)]">{error}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Título                                                              */
/* ------------------------------------------------------------------ */

export function EditableTitle({
  gameId,
  editable,
  value,
  children,
}: {
  gameId: string;
  editable: boolean;
  value: string;
  /** Markup de display (el h1 + badges) renderizado por el server. */
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { save, saving, error } = usePatchGame(gameId);

  if (!editable) return <>{children}</>;

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {children}
        <PencilButton onClick={() => { setDraft(value); setEditing(true); }} label="Editar título" />
      </span>
    );
  }

  return (
    <form
      className="w-full"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        if (await save({ title: draft.trim() })) setEditing(false);
      }}
    >
      <input
        autoFocus
        className="w-full rounded-ln-md border border-ln-border bg-ln-bg-deep px-3 py-1.5 font-display text-[28px] font-extrabold tracking-tight text-white outline-none focus:ring-2 focus:ring-ln-luna/25 ln:text-[36px]"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <EditBar saving={saving} error={error} onCancel={() => setEditing(false)} />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Descripción                                                         */
/* ------------------------------------------------------------------ */

export function EditableDescription({
  gameId,
  editable,
  value,
}: {
  gameId: string;
  editable: boolean;
  value: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const { save, saving, error } = usePatchGame(gameId);

  if (editing) {
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save({ description: draft })) setEditing(false);
        }}
      >
        <textarea
          autoFocus
          rows={6}
          className={inputCls}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <EditBar saving={saving} error={error} onCancel={() => setEditing(false)} />
      </form>
    );
  }

  return (
    <div className="group relative">
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ln-muted">
        {value || "Sin descripción."}
      </p>
      {editable ? (
        <div className="mt-2">
          <PencilButton onClick={() => { setDraft(value); setEditing(true); }} label="Editar descripción" />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Precio                                                              */
/* ------------------------------------------------------------------ */

export function EditablePrice({
  gameId,
  editable,
  value,
}: {
  gameId: string;
  editable: boolean;
  value: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const { save, saving, error } = usePatchGame(gameId);

  const display = (
    <span
      className={`font-mono text-2xl font-bold ${
        value === 0 ? "text-ln-aurora-bright" : "text-ln-corona-bright"
      }`}
    >
      {priceLabel(value)}
    </span>
  );

  if (!editable) return display;

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {display}
        <PencilButton onClick={() => { setDraft(String(value)); setEditing(true); }} label="Editar precio" />
      </span>
    );
  }

  return (
    <form
      className="w-full"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save({ priceSats: Number(draft) })) setEditing(false);
      }}
    >
      <div className="flex items-center gap-2">
        <input
          autoFocus
          type="number"
          min={0}
          className={`${inputCls} max-w-[160px]`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <span className="text-xs text-ln-faint">sats · 0 = gratis</span>
      </div>
      <EditBar saving={saving} error={error} onCancel={() => setEditing(false)} />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Categorías                                                          */
/* ------------------------------------------------------------------ */

export function EditableCategories({
  gameId,
  editable,
  value,
}: {
  gameId: string;
  editable: boolean;
  value: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const { save, saving, error } = usePatchGame(gameId);

  const chips = value.map((c) => (
    <Link
      key={c}
      href={`/?cat=${c}`}
      className="rounded-full border border-ln-border px-2.5 py-0.5 text-xs text-ln-muted transition-colors hover:bg-white/5"
    >
      {categoryLabel(c)}
    </Link>
  ));

  if (!editable) return <>{chips}</>;

  if (!editing) {
    return (
      <>
        {chips}
        <PencilButton onClick={() => { setDraft(value); setEditing(true); }} label="Editar categorías" />
      </>
    );
  }

  return (
    <form
      className="w-full"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save({ categories: draft })) setEditing(false);
      }}
    >
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const on = draft.includes(c.slug);
          return (
            <button
              key={c.slug}
              type="button"
              onClick={() =>
                setDraft((prev) =>
                  on ? prev.filter((s) => s !== c.slug) : [...prev, c.slug],
                )
              }
              className={cn("chip", on && "chip-on")}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <EditBar saving={saving} error={error} onCancel={() => setEditing(false)} />
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Enlace del juego (gameUrl)                                          */
/* ------------------------------------------------------------------ */

export function EditableGameUrl({
  gameId,
  value,
}: {
  gameId: string;
  value: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const { save, saving, error } = usePatchGame(gameId);

  return (
    <div className="border-t border-ln-border py-1.5">
      <div className="flex items-center justify-between gap-2">
        <dt className="text-ln-faint">Enlace del juego</dt>
        {!editing ? (
          <dd className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ln-text">{value || "— sin enlace"}</span>
            <PencilButton onClick={() => { setDraft(value ?? ""); setEditing(true); }} label="Editar enlace" />
          </dd>
        ) : null}
      </div>
      {editing ? (
        <form
          className="mt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save({ gameUrl: draft })) setEditing(false);
          }}
        >
          <input
            autoFocus
            className={inputCls}
            placeholder="https://tu-juego.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <EditBar saving={saving} error={error} onCancel={() => setEditing(false)} />
        </form>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Imágenes (portada vertical/horizontal + capturas)                  */
/* ------------------------------------------------------------------ */

export function EditableMedia({
  gameId,
  editable,
  coverUrl,
  horizontalCoverUrl,
  screenshots,
  children,
}: {
  gameId: string;
  editable: boolean;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
  screenshots: string;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cover, setCover] = useState(coverUrl ?? "");
  const [horizontal, setHorizontal] = useState(horizontalCoverUrl ?? "");
  const [shots, setShots] = useState<string[]>(parseScreenshotUrls(screenshots));
  const { save, saving, error, setError } = usePatchGame(gameId);

  async function uploadFile(file: File): Promise<string | null> {
    setUploading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/upload?filename=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "No se pudo subir la imagen");
        return null;
      }
      return d.url as string;
    } finally {
      setUploading(false);
    }
  }

  if (!editable) return <>{children}</>;

  return (
    <div className="space-y-3">
      <div className="relative">
        {children}
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setCover(coverUrl ?? "");
              setHorizontal(horizontalCoverUrl ?? "");
              setShots(parseScreenshotUrls(screenshots));
              setEditing(true);
            }}
            className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/70 px-3 py-1 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/85"
          >
            ✎ Editar imágenes
          </button>
        ) : null}
      </div>

      {editing ? (
        <form
          className="space-y-4 rounded-ln-lg border border-ln-border bg-ln-card/60 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await save({
              coverUrl: cover,
              horizontalCoverUrl: horizontal,
              screenshots: shots,
            });
            if (ok) setEditing(false);
          }}
        >
          {/* Portada vertical */}
          <div>
            <label className="block text-sm text-ln-soft">Portada vertical</label>
            <div className="mt-1 flex items-center gap-3">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" className="h-16 w-12 rounded object-cover" />
              ) : null}
              <input
                className={inputCls}
                placeholder="URL de portada…"
                value={cover}
                onChange={(e) => setCover(e.target.value)}
              />
            </div>
            <UploadButton uploading={uploading} onPick={async (f) => {
              const url = await uploadFile(f);
              if (url) setCover(url);
            }} label="📷 Subir portada" />
          </div>

          {/* Portada horizontal */}
          <div>
            <label className="block text-sm text-ln-soft">Portada horizontal</label>
            <div className="mt-1 space-y-2">
              {horizontal ? (
                <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded border border-ln-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={horizontal} alt="" className="absolute inset-0 h-full w-full object-cover" />
                </div>
              ) : null}
              <input
                className={inputCls}
                placeholder="URL de portada horizontal…"
                value={horizontal}
                onChange={(e) => setHorizontal(e.target.value)}
              />
            </div>
            <UploadButton uploading={uploading} onPick={async (f) => {
              const url = await uploadFile(f);
              if (url) setHorizontal(url);
            }} label="Subir portada horizontal" />
          </div>

          {/* Capturas */}
          <div>
            <label className="block text-sm text-ln-soft">Capturas</label>
            {shots.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {shots.map((src, i) => (
                  <div key={src} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-16 w-16 rounded object-cover" />
                    <button
                      type="button"
                      onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -right-1 -top-1 rounded-full bg-black/80 px-1.5 text-xs leading-tight text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <UploadButton uploading={uploading} onPick={async (f) => {
              const url = await uploadFile(f);
              if (url) setShots((prev) => [...prev, url]);
            }} label="➕ Agregar captura" />
          </div>

          <EditBar saving={saving} error={error} onCancel={() => setEditing(false)} />
        </form>
      ) : null}
    </div>
  );
}

function UploadButton({
  uploading,
  onPick,
  label,
}: {
  uploading: boolean;
  onPick: (file: File) => void | Promise<void>;
  label: string;
}) {
  return (
    <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-ln-text hover:bg-white/5">
      {uploading ? "Subiendo…" : label}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          await onPick(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
