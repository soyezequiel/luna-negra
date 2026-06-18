"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  GameFormFields,
  parseShots,
  type GameForm,
} from "@/components/provider/game-form-fields";

type Props = {
  gameId: string;
  title: string;
  description: string;
  categories: string[];
  priceSats: number;
  gameUrl: string | null;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
  screenshots: string;
};

/**
 * Lápiz de edición que solo se renderiza si la cuenta logueada es la proveedora
 * dueña del juego (el server decide y monta este componente). Abre un modal con
 * la ficha completa editable y guarda en caliente vía PATCH, refrescando la
 * página de la tienda para ver los cambios.
 */
export function GameOwnerEditor(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GameForm>(() => fromProps(props));

  function openEditor() {
    setForm(fromProps(props));
    setError(null);
    setOpen(true);
  }

  function close() {
    if (saving) return;
    setOpen(false);
  }

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

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, priceSats: Number(form.priceSats) };
      const r = await fetch(`/api/provider/games/${props.gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "No se pudieron guardar los cambios");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        title="Editar ficha"
        aria-label="Editar ficha"
        className="inline-flex items-center gap-1.5 rounded-full border border-ln-border px-3 py-1 text-xs font-medium text-ln-muted transition-colors hover:bg-white/5 hover:text-ln-text"
      >
        <PencilIcon />
        Editar
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4"
          onClick={close}
        >
          <form
            onSubmit={save}
            onClick={(e) => e.stopPropagation()}
            className="my-8 w-full max-w-2xl space-y-3 rounded-ln-lg border border-line-2 bg-panel-2 p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink">Editar ficha</h3>
              <button
                type="button"
                onClick={close}
                className="text-faint hover:text-ink"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <GameFormFields
              form={form}
              setForm={setForm}
              uploadFile={uploadFile}
              uploading={uploading}
            />

            {error ? (
              <p className="text-sm text-[var(--lose)]">{error}</p>
            ) : null}

            <div className="flex gap-3 pt-1">
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={close}
                disabled={saving}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function fromProps(p: Props): GameForm {
  return {
    title: p.title,
    description: p.description,
    categories: p.categories ?? [],
    priceSats: String(p.priceSats),
    gameUrl: p.gameUrl ?? "",
    coverUrl: p.coverUrl ?? "",
    horizontalCoverUrl: p.horizontalCoverUrl ?? "",
    screenshots: parseShots(p.screenshots),
  };
}

function PencilIcon() {
  return (
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
  );
}
