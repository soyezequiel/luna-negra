"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/categories";

const inputCls =
  "w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-500/50";

type Provider = { id: string; name: string; lightningAddress: string | null };
type Game = {
  id: string;
  title: string;
  slug: string;
  description: string;
  category: string | null;
  priceSats: number;
  gameUrl: string | null;
  coverUrl: string | null;
  screenshots: string;
  status: string;
};
type Sale = {
  id: string;
  gameTitle: string;
  share: number;
  payoutStatus: string;
};
type GameForm = {
  title: string;
  description: string;
  category: string;
  priceSats: string;
  gameUrl: string;
  coverUrl: string;
  screenshots: string[];
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  published: "Publicado",
};
const PAYOUT_LABEL: Record<string, string> = {
  none: "—",
  pending: "En proceso",
  paid: "Pagado",
  failed: "Falló",
  skipped: "Sin dirección",
};

const emptyForm: GameForm = {
  title: "",
  description: "",
  category: "",
  priceSats: "0",
  gameUrl: "",
  coverUrl: "",
  screenshots: [],
};

function parseShots(json: string): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function ProviderPage() {
  const { user, login, loading } = useSession();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [ln, setLn] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GameForm>({ ...emptyForm });
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      fetch("/api/provider").then((r) => r.json()).catch(() => null),
      fetch("/api/provider/sales").then((r) => r.json()).catch(() => ({ sales: [] })),
    ]);
    if (d?.provider) {
      setProvider(d.provider);
      setName(d.provider.name);
      setLn(d.provider.lightningAddress ?? "");
    }
    setGames(d?.games ?? []);
    setSales(s?.sales ?? []);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function uploadFile(file: File): Promise<string | null> {
    setUploading(true);
    setMsg(null);
    try {
      const r = await fetch(
        `/api/upload?filename=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.error ?? "No se pudo subir la imagen");
        return null;
      }
      return d.url as string;
    } finally {
      setUploading(false);
    }
  }

  async function saveProvider(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await fetch("/api/provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, lightningAddress: ln }),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "Error");
    setProvider(d.provider);
    setMsg("Perfil guardado.");
  }

  function startEdit(g: Game) {
    setEditingId(g.id);
    setForm({
      title: g.title,
      description: g.description,
      category: g.category ?? "",
      priceSats: String(g.priceSats),
      gameUrl: g.gameUrl ?? "",
      coverUrl: g.coverUrl ?? "",
      screenshots: parseShots(g.screenshots),
    });
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ ...emptyForm });
  }

  async function submitGame(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload = { ...form, priceSats: Number(form.priceSats) };
    const url = editingId
      ? `/api/provider/games/${editingId}`
      : "/api/provider/games";
    const r = await fetch(url, {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "Error");
    setMsg(editingId ? "Cambios guardados." : "Juego creado (borrador).");
    cancelEdit();
    load();
  }

  async function action(id: string, path: string, method = "POST") {
    await fetch(`/api/provider/games/${id}${path}`, { method });
    load();
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar este juego? No se puede deshacer.")) return;
    const r = await fetch(`/api/provider/games/${id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error ?? "No se pudo borrar");
    load();
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Proveedor</h1>
        <p className="mt-2 text-zinc-400">Conectá tu Nostr para publicar juegos.</p>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Panel de proveedor</h1>
      {msg ? <p className="mt-2 text-sm text-sky-400">{msg}</p> : null}

      <form
        onSubmit={saveProvider}
        className="mt-6 space-y-3 rounded-xl border border-white/10 bg-white/5 p-5"
      >
        <h2 className="font-semibold">
          {provider ? "Tu perfil" : "Creá tu perfil de proveedor"}
        </h2>
        <input
          className={inputCls}
          placeholder="Nombre del estudio"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Lightning Address para el payout (ej. vos@getalby.com)"
          value={ln}
          onChange={(e) => setLn(e.target.value)}
        />
        <Button type="submit">{provider ? "Guardar" : "Crear perfil"}</Button>
      </form>

      {provider ? (
        <>
          <form
            onSubmit={submitGame}
            className="mt-8 space-y-3 rounded-xl border border-white/10 bg-white/5 p-5"
          >
            <h2 className="font-semibold">
              {editingId ? "Editar juego" : "Nuevo juego"}
            </h2>
            <input
              className={inputCls}
              placeholder="Título"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <textarea
              className={inputCls}
              placeholder="Descripción"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm text-zinc-400">Precio (sats)</label>
                <input
                  className={`${inputCls} mt-1`}
                  type="number"
                  min={0}
                  placeholder="0 = gratis"
                  value={form.priceSats}
                  onChange={(e) =>
                    setForm({ ...form, priceSats: e.target.value })
                  }
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm text-zinc-400">Categoría</label>
                <select
                  className={`${inputCls} mt-1`}
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                >
                  <option value="">Sin categoría</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <input
              className={inputCls}
              placeholder="URL del juego (subdominio)"
              value={form.gameUrl}
              onChange={(e) => setForm({ ...form, gameUrl: e.target.value })}
            />

            {/* Portada */}
            <div>
              <label className="block text-sm text-zinc-400">Portada</label>
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
                    setForm({ ...form, coverUrl: e.target.value })
                  }
                />
              </div>
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5">
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

            {/* Capturas */}
            <div>
              <label className="block text-sm text-zinc-400">Capturas</label>
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
                            screenshots: prev.screenshots.filter(
                              (_, j) => j !== i,
                            ),
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
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5">
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

            {msg ? <p className="text-xs text-amber-400">{msg}</p> : null}
            <div className="flex gap-3">
              <Button type="submit">
                {editingId ? "Guardar cambios" : "Crear borrador"}
              </Button>
              {editingId ? (
                <Button type="button" variant="ghost" onClick={cancelEdit}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>

          <section className="mt-8">
            <h2 className="mb-3 font-semibold">Tus juegos</h2>
            {games.length === 0 ? (
              <p className="text-sm text-zinc-500">Todavía no creaste juegos.</p>
            ) : (
              <ul className="space-y-2">
                {games.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{g.title}</p>
                      <p className="text-xs text-zinc-500">
                        {STATUS_LABEL[g.status] ?? g.status} ·{" "}
                        {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" onClick={() => startEdit(g)}>
                        Editar
                      </Button>
                      {g.status === "draft" ? (
                        <Button
                          variant="outline"
                          onClick={() => action(g.id, "/submit")}
                        >
                          Enviar a revisión
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => action(g.id, "/unpublish")}
                        >
                          Despublicar
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => remove(g.id)}>
                        Borrar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <h2 className="mb-3 font-semibold">Ventas</h2>
            {sales.length === 0 ? (
              <p className="text-sm text-zinc-500">Todavía no hay ventas.</p>
            ) : (
              <ul className="space-y-2">
                {sales.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm"
                  >
                    <span>{s.gameTitle}</span>
                    <span className="text-zinc-400">
                      {s.share} sats ·{" "}
                      <span
                        className={
                          s.payoutStatus === "paid"
                            ? "text-emerald-400"
                            : s.payoutStatus === "failed"
                              ? "text-red-400"
                              : "text-amber-400"
                        }
                      >
                        {PAYOUT_LABEL[s.payoutStatus] ?? s.payoutStatus}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
