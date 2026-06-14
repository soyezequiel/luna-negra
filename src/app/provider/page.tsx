"use client";

import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";

import { satsLabel } from "@/lib/format";

const inputCls =
  "w-full rounded-ln-md border border-ln-border bg-ln-bg-deep px-3 py-2 text-sm text-ln-text outline-none transition-shadow placeholder:text-ln-faint focus:ring-2 focus:ring-ln-luna/25";

type Provider = {
  id: string;
  name: string;
  lightningAddress: string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
};
type Game = {
  id: string;
  title: string;
  slug: string;
  description: string;
  categories: string[];
  priceSats: number;
  gameUrl: string | null;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
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
  categories: string[];
  priceSats: string;
  gameUrl: string;
  coverUrl: string;
  horizontalCoverUrl: string;
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
  categories: [],
  priceSats: "0",
  gameUrl: "",
  coverUrl: "",
  horizontalCoverUrl: "",
  screenshots: [],
};

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div
      className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4 pl-5"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <p className="ln-label">{label}</p>
      <p className="mt-1 font-display text-[27px] font-extrabold leading-none text-ln-text">
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[11.5px] text-ln-muted">{sub}</p> : null}
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  published: "bg-ln-aurora/15 text-ln-aurora",
  in_review: "bg-ln-corona/15 text-ln-corona",
  draft: "bg-white/10 text-ln-muted",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        STATUS_BADGE[status] ?? "bg-white/10 text-ln-muted"
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function parseShots(json: string): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export default function ProviderPage() {
  const { user, login, loading } = useSession();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [keyName, setKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [ln, setLn] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GameForm>({ ...emptyForm });
  const [uploading, setUploading] = useState(false);
  const [, startLoadTransition] = useTransition();

  const load = useCallback(async () => {
    const [d, s, k] = await Promise.all([
      fetch("/api/provider").then((r) => r.json()).catch(() => null),
      fetch("/api/provider/sales").then((r) => r.json()).catch(() => ({ sales: [] })),
      fetch("/api/provider/api-keys").then((r) => r.json()).catch(() => ({ keys: [] })),
    ]);
    if (d?.provider) {
      setProvider(d.provider);
      setName(d.provider.name);
      setLn(d.provider.lightningAddress ?? "");
      setWebhookUrl(d.provider.webhookUrl ?? "");
      setWebhookSecret(d.provider.webhookSecret ?? null);
    }
    setGames(d?.games ?? []);
    setSales(s?.sales ?? []);
    setApiKeys(k?.keys ?? []);
  }, []);

  async function createKey() {
    setMsg(null);
    const r = await fetch("/api/provider/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: keyName.trim() || "Clave de API" }),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "No se pudo crear la clave");
    setCreatedKey(d.key); // se muestra una sola vez
    setKeyName("");
    load();
  }

  async function revokeKey(id: string) {
    if (!confirm("¿Revocar esta clave? Dejará de funcionar al instante.")) return;
    await fetch(`/api/provider/api-keys/${id}`, { method: "DELETE" });
    load();
  }

  async function saveWebhook(regenerate = false) {
    if (
      regenerate &&
      !confirm(
        "Regenerar el secreto invalida el anterior: los webhooks firmados con el viejo dejarán de validar hasta que actualices tu game server. ¿Continuar?",
      )
    ) {
      return;
    }
    setMsg(null);
    const r = await fetch("/api/provider/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl: webhookUrl.trim(), regenerate }),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "No se pudo guardar el webhook");
    setWebhookSecret(d.webhookSecret ?? null);
    setMsg("Webhook guardado.");
  }

  useEffect(() => {
    if (!user) return;
    startLoadTransition(() => {
      void load();
    });
  }, [user, load, startLoadTransition]);

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
      categories: g.categories ?? [],
      priceSats: String(g.priceSats),
      gameUrl: g.gameUrl ?? "",
      coverUrl: g.coverUrl ?? "",
      horizontalCoverUrl: g.horizontalCoverUrl ?? "",
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
        <h1 className="text-2xl font-bold text-white">Proveedor</h1>
        <p className="mt-2 text-muted">Conectá tu Nostr para publicar juegos.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Button variant="blue" onClick={login}>
            Conectar con Nostr
          </Button>
          <Link href="/dev" className="btn btn-ghost">
            Ver guia para publicar
          </Link>
        </div>
      </div>
    );
  }

  const paidSats = sales
    .filter((s) => s.payoutStatus === "paid")
    .reduce((n, s) => n + s.share, 0);
  const pendingSats = sales
    .filter((s) => s.payoutStatus === "pending")
    .reduce((n, s) => n + s.share, 0);
  const publishedCount = games.filter((g) => g.status === "published").length;

  return (
    <div className="mx-auto max-w-[920px] px-[22px] py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Panel de proveedor
          </h1>
          <p className="mt-1 text-sm text-ln-muted">
            Gestioná tus juegos, cobros, API keys y webhooks.
          </p>
        </div>
        <Link href="/dev" className="btn btn-ghost shrink-0 self-start">
          Abrir guía /dev
        </Link>
      </div>
      {msg ? <p className="mt-2 text-sm text-ln-luna">{msg}</p> : null}

      {provider ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Ingresos pagados" value={satsLabel(paidSats)} sub="sats" accent="var(--btc)" />
          <Kpi label="Pendiente de cobro" value={satsLabel(pendingSats)} sub="sats" accent="var(--btc)" />
          <Kpi label="Juegos publicados" value={String(publishedCount)} sub={`${games.length} en total`} accent="var(--blue)" />
          <Kpi label="Ventas" value={String(sales.length)} sub="transacciones" accent="var(--win)" />
        </div>
      ) : null}

      <form
        onSubmit={saveProvider}
        className="mt-6 space-y-3 rounded-lg border border-line bg-panel p-5"
      >
        <h2 className="font-semibold text-ink">
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
            className="mt-8 space-y-3 rounded-xl border border-line bg-panel p-5"
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
            <div>
              <label className="block text-sm text-muted">Precio (sats)</label>
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
            <div>
              <label className="block text-sm text-muted">
                Categorías{" "}
                <span className="text-ln-faint">(podés elegir varias)</span>
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const on = form.categories.includes(c.slug);
                  return (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          categories: on
                            ? form.categories.filter((s) => s !== c.slug)
                            : [...form.categories, c.slug],
                        })
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
              onChange={(e) => setForm({ ...form, gameUrl: e.target.value })}
            />

            {/* Portada vertical */}
            <div>
              <label className="block text-sm text-muted">
                Portada vertical
              </label>
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
              <label className="block text-sm text-muted">
                Portada horizontal
              </label>
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
                    setForm({ ...form, horizontalCoverUrl: e.target.value })
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
                      setForm((prev) => ({
                        ...prev,
                        horizontalCoverUrl: url,
                      }));
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

            {msg ? <p className="text-xs text-btc">{msg}</p> : null}
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
              <p className="text-sm text-faint">Todavía no creaste juegos.</p>
            ) : (
              <ul className="space-y-2">
                {games.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-ln-lg border border-ln-border bg-ln-card/60 px-4 py-3"
                  >
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-ln-text">
                        {g.title}
                        <StatusBadge status={g.status} />
                      </p>
                      <p className="text-xs text-ln-faint">
                        {g.priceSats === 0 ? (
                          <span className="text-ln-aurora-bright">Gratis</span>
                        ) : (
                          <span className="font-mono text-ln-corona-bright">
                            {satsLabel(g.priceSats)} sats
                          </span>
                        )}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-faint">
                        <span>ID:</span>
                        <code className="break-all font-mono text-muted">
                          {g.id}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(g.id);
                            setMsg("ID del juego copiado.");
                          }}
                          className="text-blue hover:underline"
                        >
                          Copiar
                        </button>
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
              <p className="text-sm text-faint">Todavía no hay ventas.</p>
            ) : (
              <ul className="space-y-2">
                {sales.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-2 text-sm"
                  >
                    <span>{s.gameTitle}</span>
                    <span className="text-muted">
                      {s.share} sats ·{" "}
                      <span
                        className={
                          s.payoutStatus === "paid"
                            ? "text-green"
                            : s.payoutStatus === "failed"
                              ? "text-[var(--lose)]"
                              : "text-btc"
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

          <section className="mt-8">
            <h2 className="mb-1 font-semibold">Claves de API</h2>
            <p className="mb-3 text-xs text-faint">
              Para que tu game server cree apuestas (Bearer). Ver{" "}
              <a href="/developers" className="text-blue hover:underline">
                /developers
              </a>
              .
            </p>

            {createdKey ? (
              <div className="mb-3 rounded-lg border border-green/30 bg-green/10 p-4">
                <p className="text-sm text-green">
                  Copiá tu clave ahora — no se vuelve a mostrar:
                </p>
                <code className="mt-2 block break-all rounded bg-black/40 px-3 py-2 font-mono text-xs text-ink">
                  {createdKey}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdKey);
                    setMsg("Clave copiada.");
                  }}
                  className="mt-2 text-xs text-blue hover:underline"
                >
                  Copiar
                </button>
                <button
                  onClick={() => setCreatedKey(null)}
                  className="ml-4 text-xs text-faint hover:text-ink"
                >
                  Listo
                </button>
              </div>
            ) : null}

            <div className="flex gap-2">
              <input
                className={inputCls}
                placeholder="Nombre (ej. servidor-prod)"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={createKey}>
                Crear clave
              </Button>
            </div>

            {apiKeys.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {apiKeys.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{k.name}</span>{" "}
                      <code className="text-xs text-faint">{k.prefix}…</code>
                      <span className="ml-2 text-xs text-faint">
                        {k.lastUsedAt ? "usada" : "sin usar"}
                      </span>
                    </div>
                    <Button variant="ghost" onClick={() => revokeKey(k.id)}>
                      Revocar
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="mt-8">
            <h2 className="mb-1 font-semibold">Webhooks</h2>
            <p className="mb-3 text-xs text-faint">
              Luna Negra notifica a esta URL los eventos{" "}
              <code>purchase.completed</code>, <code>bet.settled</code> y{" "}
              <code>payout.sent</code> (firmados con HMAC).
            </p>
            <div className="flex gap-2">
              <input
                className={inputCls}
                placeholder="https://tu-server.com/webhooks/luna"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={() => saveWebhook()}>
                Guardar
              </Button>
            </div>
            {webhookSecret ? (
              <div className="mt-3 rounded-lg border border-line bg-panel p-3">
                <p className="text-xs text-muted">
                  Secreto de firma (verificá la cabecera{" "}
                  <code>X-LunaNegra-Signature</code>):
                </p>
                <code className="mt-1 block break-all font-mono text-xs text-ink">
                  {webhookSecret}
                </code>
                <button
                  onClick={() => saveWebhook(true)}
                  className="mt-2 text-xs text-blue hover:underline"
                >
                  Regenerar secreto
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
