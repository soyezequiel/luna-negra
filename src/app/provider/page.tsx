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
import { cn } from "@/lib/utils";
import {
  GameFormFields,
  emptyForm,
  inputCls,
  parseShots,
  type GameForm,
} from "@/components/provider/game-form-fields";

import { satsLabel } from "@/lib/format";

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
  const [origin, setOrigin] = useState("");
  const [envGameId, setEnvGameId] = useState("");

  const [name, setName] = useState("");
  const [ln, setLn] = useState("");

  const [newForm, setNewForm] = useState<GameForm>({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<GameForm>({ ...emptyForm });
  const [uploading, setUploading] = useState(false);
  const [, startLoadTransition] = useTransition();

  useEffect(() => {
    // Se lee tras montar (no en el initializer) para no provocar un mismatch de
    // hidratación: el server no conoce window.location.origin.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setMsg(label);
  }

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
    setEditForm({
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
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({ ...emptyForm });
  }

  async function createGame(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload = { ...newForm, priceSats: Number(newForm.priceSats) };
    const r = await fetch("/api/provider/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "Error");
    setMsg(
      "Juego creado como borrador. Envialo a revisión (botón abajo) para que se apruebe y se publique.",
    );
    setNewForm({ ...emptyForm });
    load();
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setMsg(null);
    const payload = { ...editForm, priceSats: Number(editForm.priceSats) };
    const r = await fetch(`/api/provider/games/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "Error");
    setMsg("Cambios guardados.");
    cancelEdit();
    load();
  }

  async function action(
    id: string,
    path: string,
    okMsg?: string,
    method = "POST",
  ) {
    await fetch(`/api/provider/games/${id}${path}`, { method });
    if (okMsg) setMsg(okMsg);
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

  const selectedGameId = envGameId || games[0]?.id || "";
  const envText = [
    `LUNA_NEGRA_BASE=${origin || "https://tu-deploy"}`,
    `LUNA_NEGRA_API_KEY=${createdKey ?? "ln_sk_…"}`,
    `LUNA_NEGRA_WEBHOOK_SECRET=${webhookSecret ?? "whsec_…"}`,
    `LUNA_NEGRA_GAME_ID=${selectedGameId || "game_…"}`,
  ].join("\n");

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
        <div className="flex shrink-0 gap-2 self-start">
          <Link href="/provider/integracion" className="btn btn-ghost">
            Integración
          </Link>
          <Link href="/dev" className="btn btn-ghost">
            Abrir guía /dev
          </Link>
        </div>
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
          <section className="mt-8 rounded-xl border border-ln-luna/30 bg-ln-card/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-ink">Variables de entorno</h2>
              <button
                type="button"
                onClick={() => copy(envText, "Variables de entorno copiadas.")}
                className="text-xs text-blue hover:underline"
              >
                Copiar todo
              </button>
            </div>
            <p className="mt-1 text-xs text-faint">
              Todo lo que tu game server necesita, junto. Pegalo en el archivo{" "}
              <code>.env</code> de tu servidor. La API key solo se ve al crearla
              (abajo, en{" "}
              <a href="#api-keys" className="text-blue hover:underline">
                Claves de API
              </a>
              ); el resto lo podés copiar cuando quieras.
            </p>

            {games.length > 1 ? (
              <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                Juego para <code>LUNA_NEGRA_GAME_ID</code>:
                <select
                  className={cn(inputCls, "max-w-xs")}
                  value={selectedGameId}
                  onChange={(e) => setEnvGameId(e.target.value)}
                >
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 px-3 py-3 font-mono text-xs text-ink">{envText}</pre>

            <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-faint">
              <li>
                <code>LUNA_NEGRA_BASE</code> — URL de la tienda.
              </li>
              <li>
                <code>LUNA_NEGRA_API_KEY</code> — clave secreta de tu servidor
                (<code>ln_sk_…</code>). Solo en el server, nunca en el navegador.
              </li>
              <li>
                <code>LUNA_NEGRA_WEBHOOK_SECRET</code> — firma HMAC de los
                webhooks (<code>whsec_…</code>).
              </li>
              <li>
                <code>LUNA_NEGRA_GAME_ID</code> — id del juego que integrás.
              </li>
            </ul>
          </section>

          <form
            onSubmit={createGame}
            className="mt-8 space-y-3 rounded-xl border border-line bg-panel p-5"
          >
            <h2 className="font-semibold">Nuevo juego</h2>
            <p className="text-xs text-ln-faint">
              Se crea como <strong>borrador</strong> (no visible en la tienda).
              Después tenés que <strong>enviarlo a revisión</strong>: un admin lo
              aprueba y recién ahí se publica.
            </p>
            <GameFormFields
              form={newForm}
              setForm={setNewForm}
              uploadFile={uploadFile}
              uploading={uploading}
            />
            {msg ? <p className="text-xs text-btc">{msg}</p> : null}
            <Button type="submit">Crear borrador</Button>
          </form>

          <section className="mt-8">
            <h2 className="mb-3 font-semibold">Tus juegos</h2>
            {games.length === 0 ? (
              <p className="text-sm text-faint">Todavía no creaste juegos.</p>
            ) : (
              <ul className="space-y-2">
                {games.map((g) => {
                  const editing = editingId === g.id;
                  return (
                    <li
                      key={g.id}
                      className={cn(
                        "rounded-ln-lg border border-ln-border bg-ln-card/60",
                        editing
                          ? "p-5 ring-1 ring-ln-luna/30"
                          : "flex flex-wrap items-center justify-between gap-2 px-4 py-3",
                      )}
                    >
                      {editing ? (
                        <form onSubmit={saveEdit} className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-ln-text">
                              Editar “{g.title}”
                              <StatusBadge status={g.status} />
                            </h3>
                          </div>
                          <GameFormFields
                            form={editForm}
                            setForm={setEditForm}
                            uploadFile={uploadFile}
                            uploading={uploading}
                          />
                          {msg ? (
                            <p className="text-xs text-btc">{msg}</p>
                          ) : null}
                          <div className="flex gap-3">
                            <Button type="submit">Guardar cambios</Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={cancelEdit}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div>
                            <p className="flex items-center gap-2 text-sm font-medium text-ln-text">
                              {g.title}
                              <StatusBadge status={g.status} />
                            </p>
                            <p className="text-xs text-ln-faint">
                              {g.priceSats === 0 ? (
                                <span className="text-ln-aurora-bright">
                                  Gratis
                                </span>
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
                            {g.status === "draft" ? (
                              <p className="mt-1 text-xs text-ln-corona">
                                Todavía no es visible en la tienda — envialo a
                                revisión.
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="ghost"
                              onClick={() => startEdit(g)}
                            >
                              Editar
                            </Button>
                            {g.status === "draft" ? (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  action(
                                    g.id,
                                    "/submit",
                                    "Enviado a revisión. Te avisamos cuando se apruebe.",
                                  )
                                }
                              >
                                Enviar a revisión
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  action(
                                    g.id,
                                    "/unpublish",
                                    "Juego despublicado.",
                                  )
                                }
                              >
                                Despublicar
                              </Button>
                            )}
                            <Button variant="ghost" onClick={() => remove(g.id)}>
                              Borrar
                            </Button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
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

          <section id="api-keys" className="mt-8 scroll-mt-20">
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
