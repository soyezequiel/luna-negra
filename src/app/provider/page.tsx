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
import { normalizeCategories } from "@/lib/categories";
import { ZapLeaderboard } from "@/components/zap-leaderboard";

import { hueFromSlug, satsLabel } from "@/lib/format";

type Provider = {
  id: string;
  name: string;
  imageUrl?: string | null;
  lightningAddress: string | null;
  betDevFeePct?: number;
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
  videos: string;
  status: string;
  betDevFeePct: number | null;
  isBeta: boolean;
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

type Tab = "games" | "sales" | "integration" | "profile";

/** Portada generada por color (fallback cuando no hay coverUrl). */
function coverBg(seed: string): string {
  const h = hueFromSlug(seed);
  return `radial-gradient(130% 100% at 20% 8%, hsl(${h} 70% 34% / .95), transparent 60%), radial-gradient(130% 120% at 85% 95%, hsl(${(h + 50) % 360} 78% 26% / .95), transparent 65%), linear-gradient(160deg, hsl(${h} 52% 22%), hsl(${(h + 28) % 360} 58% 11%))`;
}

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
      className="relative overflow-hidden rounded-ln-lg border border-ln-border bg-ln-card/60 p-4 pl-5"
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

function TabNav({
  tab,
  setTab,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const items: { id: Tab; label: string }[] = [
    { id: "games", label: "Juegos" },
    { id: "sales", label: "Ventas" },
    { id: "integration", label: "Integración" },
    { id: "profile", label: "Perfil" },
  ];
  return (
    <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-ln-border bg-ln-card/55 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => setTab(it.id)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full px-5 py-2 text-[13.5px] font-semibold transition-colors",
            tab === it.id
              ? "text-[#1a1430]"
              : "text-ln-muted hover:text-ln-text",
          )}
          style={
            tab === it.id
              ? { backgroundImage: "linear-gradient(120deg,#c2b5ff,#9d8cff)" }
              : undefined
          }
        >
          {it.label}
        </button>
      ))}
    </div>
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

  const [tab, setTab] = useState<Tab>("games");
  const [showNewGame, setShowNewGame] = useState(false);

  const [name, setName] = useState("");
  const [ln, setLn] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [betDevFee, setBetDevFee] = useState("0");

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
      setImageUrl(d.provider.imageUrl ?? "");
      setLn(d.provider.lightningAddress ?? "");
      setBetDevFee(String(d.provider.betDevFeePct ?? 0));
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
      body: JSON.stringify({
        name,
        lightningAddress: ln,
        imageUrl,
        betDevFeePct: betDevFee.trim() === "" ? 0 : betDevFee,
      }),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "Error");
    setProvider(d.provider);
    setImageUrl(d.provider.imageUrl ?? "");
    setBetDevFee(String(d.provider.betDevFeePct ?? 0));
    setMsg("Perfil guardado.");
  }

  function startEdit(g: Game) {
    setEditingId(g.id);
    setEditForm({
      title: g.title,
      description: g.description,
      categories: normalizeCategories(g.categories),
      priceSats: String(g.priceSats),
      gameUrl: g.gameUrl ?? "",
      coverUrl: g.coverUrl ?? "",
      horizontalCoverUrl: g.horizontalCoverUrl ?? "",
      screenshots: parseShots(g.screenshots),
      videos: parseShots(g.videos),
      betDevFeePct: g.betDevFeePct == null ? "" : String(g.betDevFeePct),
      isBeta: g.isBeta,
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
    setShowNewGame(false);
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

  // Duplica un juego: crea una copia en borrador con la misma ficha (sin compras
  // ni identidad en Nostr). Después se puede editar o enviar a revisión.
  async function duplicate(id: string) {
    setMsg(null);
    const r = await fetch(`/api/provider/games/${id}/duplicate`, {
      method: "POST",
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error ?? "No se pudo duplicar");
    setMsg("Copia creada como borrador.");
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

  // Sin perfil aún: pantalla enfocada en crearlo (sin pestañas ni KPIs).
  if (!provider) {
    return (
      <div className="mx-auto max-w-[920px] px-[22px] py-8">
        <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
          Panel de proveedor
        </h1>
        <p className="mt-1 text-sm text-ln-muted">
          Creá tu perfil para empezar a publicar juegos y cobrar con Lightning.
        </p>
        {msg ? <p className="mt-2 text-sm text-ln-luna">{msg}</p> : null}
        <form
          onSubmit={saveProvider}
          className="mt-6 max-w-lg space-y-3 rounded-ln-lg border border-ln-border bg-ln-card/60 p-5"
        >
          <h2 className="font-semibold text-ink">Creá tu perfil de proveedor</h2>
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
          <Button type="submit">Crear perfil</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1040px] px-[22px] py-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ln-label mb-2">Estudio · {provider.name}</p>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Panel de proveedor
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:flex-nowrap sm:self-end">
          <Link href="/provider/stats" className="btn btn-ghost">
            Estadísticas
          </Link>
          <Link href="/provider/integracion" className="btn btn-ghost">
            Integración
          </Link>
          <Link href="/dev" className="btn btn-ghost">
            Guía /dev
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Ingresos pagados" value={satsLabel(paidSats)} sub="sats" accent="var(--btc)" />
        <Kpi label="Pendiente de cobro" value={satsLabel(pendingSats)} sub="sats" accent="var(--btc)" />
        <Kpi label="Juegos publicados" value={String(publishedCount)} sub={`${games.length} en total`} accent="var(--blue)" />
        <Kpi label="Ventas" value={String(sales.length)} sub="transacciones" accent="var(--win)" />
      </div>

      {/* Tabs */}
      <div className="mt-8">
        <TabNav tab={tab} setTab={setTab} />
      </div>

      {msg ? <p className="mt-3 text-sm text-ln-luna">{msg}</p> : null}

      {/* ===== JUEGOS ===== */}
      {tab === "games" ? (
        <section className="mt-6 animate-ln-rise">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[19px] font-bold">Tus juegos</h2>
            <Button
              variant={showNewGame ? "ghost" : "luna"}
              size="sm"
              onClick={() => setShowNewGame((v) => !v)}
            >
              {showNewGame ? "Cerrar" : "Nuevo juego"}
            </Button>
          </div>

          {showNewGame ? (
            <form
              onSubmit={createGame}
              className="mb-5 space-y-5 rounded-ln-lg border border-ln-border bg-ln-card/60 p-5"
            >
              <div className="flex flex-col gap-3 border-b border-ln-border pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold text-ln-text">
                    Registrar nuevo juego
                  </h3>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ln-faint">
                    Empezás creando un borrador privado. Después lo completás y
                    lo enviás a revisión cuando la ficha esté lista.
                  </p>
                </div>
                <span className="w-fit rounded-full border border-ln-luna/25 bg-ln-luna/10 px-3 py-1 text-[10.5px] font-semibold uppercase text-ln-luna">
                  1 dato obligatorio
                </span>
              </div>
              <GameFormFields
                form={newForm}
                setForm={setNewForm}
                uploadFile={uploadFile}
                uploading={uploading}
                devFeeDefault={provider.betDevFeePct ?? 0}
                mode="create"
              />
              <div className="flex flex-wrap items-center gap-3 border-t border-ln-border pt-4">
                <Button type="submit">Crear borrador privado</Button>
                <p className="max-w-md text-xs leading-relaxed text-ln-faint">
                  El borrador queda en tu lista de juegos para seguir editándolo
                  antes de enviarlo a revisión.
                </p>
              </div>
            </form>
          ) : null}

          {games.length === 0 ? (
            <p className="text-sm text-faint">Todavía no creaste juegos.</p>
          ) : editingId ? (
            (() => {
              const g = games.find((x) => x.id === editingId);
              if (!g) return null;
              return (
                <form
                  onSubmit={saveEdit}
                  className="space-y-3 rounded-ln-lg border border-ln-border bg-ln-card/60 p-5 ring-1 ring-ln-luna/30"
                >
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-ln-text">
                    Editar “{g.title}”
                    <StatusBadge status={g.status} />
                  </h3>
                  <GameFormFields
                    form={editForm}
                    setForm={setEditForm}
                    uploadFile={uploadFile}
                    uploading={uploading}
                    devFeeDefault={provider.betDevFeePct ?? 0}
                  />
                  <div className="flex gap-3">
                    <Button type="submit">Guardar cambios</Button>
                    <Button type="button" variant="ghost" onClick={cancelEdit}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              );
            })()
          ) : (
            <div className="grid gap-3.5 sm:grid-cols-2">
              {games.map((g) => (
                <div
                  key={g.id}
                  className="flex gap-3.5 rounded-ln-lg border border-ln-border bg-ln-card/60 p-3.5"
                >
                  <div className="relative h-[90px] w-[72px] shrink-0 overflow-hidden rounded-ln-md">
                    {g.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={g.coverUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <span
                        className="absolute inset-0"
                        style={{ background: coverBg(g.slug || g.id) }}
                      />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14.5px] font-medium text-ln-text">
                        {g.title}
                      </span>
                      <StatusBadge status={g.status} />
                      {g.isBeta ? (
                        <span className="rounded-full bg-ln-luna/15 px-2 py-0.5 text-[10px] font-semibold text-ln-luna">
                          Beta
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 font-mono text-[12.5px]">
                      {g.priceSats === 0 ? (
                        <span className="text-ln-aurora-bright">Gratis</span>
                      ) : (
                        <span className="text-ln-corona-bright">
                          {satsLabel(g.priceSats)} sats
                        </span>
                      )}
                    </p>
                    <p className="mt-1 flex items-center gap-1 truncate font-mono text-[11px] text-ln-faint">
                      <code className="truncate">{g.id}</code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(g.id);
                          setMsg("ID del juego copiado.");
                        }}
                        className="shrink-0 text-blue hover:underline"
                      >
                        Copiar
                      </button>
                    </p>
                    {g.status === "draft" ? (
                      <p className="mt-1 text-[11px] text-ln-corona">
                        Todavía no es visible — envialo a revisión.
                      </p>
                    ) : null}
                    <div className="mt-auto flex flex-wrap gap-2 pt-3">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(g)}>
                        Editar
                      </Button>
                      {g.status === "draft" ? (
                        <Button
                          variant="outline"
                          size="sm"
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
                          size="sm"
                          onClick={() =>
                            action(g.id, "/unpublish", "Juego despublicado.")
                          }
                        >
                          Despublicar
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => duplicate(g.id)}>
                        Duplicar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(g.id)}>
                        Borrar
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setShowNewGame(true)}
                className="flex min-h-[118px] flex-col items-center justify-center gap-2 rounded-ln-lg border border-dashed border-ln-luna/35 bg-ln-luna/[.04] text-[14px] font-semibold text-ln-luna transition-colors hover:bg-ln-luna/10"
              >
                <span className="text-[22px] leading-none">+</span>
                Crear un nuevo juego
              </button>
            </div>
          )}
        </section>
      ) : null}

      {/* ===== VENTAS ===== */}
      {tab === "sales" ? (
        <section className="mt-6 animate-ln-rise">
          {/* Top de zappers acumulado (todos los juegos del dev). Sale de los
              recibos 9735 verificados (zap-sync.ts). */}
          <div className="mb-6 max-w-lg">
            <ZapLeaderboard
              scope="provider"
              providerId={provider.id}
              title="Tus mayores apoyos ⚡"
            />
          </div>
          <h2 className="mb-4 font-display text-[19px] font-bold">Ventas recientes</h2>
          {sales.length === 0 ? (
            <p className="text-sm text-faint">Todavía no hay ventas.</p>
          ) : (
            <div className="overflow-hidden rounded-ln-lg border border-ln-border bg-ln-card/60">
              <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-ln-border px-[18px] py-3">
                <span className="ln-label">Juego</span>
                <span className="ln-label">Tu parte</span>
                <span className="ln-label text-right">Estado</span>
              </div>
              {sales.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-ln-border/60 px-[18px] py-3 text-sm last:border-0"
                >
                  <span className="text-ln-text">{s.gameTitle}</span>
                  <span className="font-mono text-[13px] text-ln-corona-bright">
                    {satsLabel(s.share)} sats
                  </span>
                  <span
                    className={cn(
                      "min-w-[90px] text-right text-[12px] font-semibold",
                      s.payoutStatus === "paid"
                        ? "text-green"
                        : s.payoutStatus === "failed"
                          ? "text-[var(--lose)]"
                          : s.payoutStatus === "skipped"
                            ? "text-ln-muted"
                            : "text-btc",
                    )}
                  >
                    {PAYOUT_LABEL[s.payoutStatus] ?? s.payoutStatus}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ===== INTEGRACIÓN ===== */}
      {tab === "integration" ? (
        <section className="mt-6 grid animate-ln-rise items-start gap-3.5 lg:grid-cols-2">
          {/* env vars */}
          <div className="rounded-ln-lg border border-ln-luna/30 bg-ln-card/60 p-5 lg:col-span-2">
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
              (en <strong>Claves de API</strong>, abajo); el resto lo podés
              copiar cuando quieras.
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

            <pre className="mt-3 overflow-x-auto rounded-ln-md bg-black/40 px-3 py-3 font-mono text-xs text-ink">{envText}</pre>
          </div>

          {/* api keys */}
          <div id="api-keys" className="scroll-mt-20 rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
            <h2 className="font-semibold">Claves de API</h2>
            <p className="mb-3 mt-1 text-xs text-faint">
              Para que tu game server cree apuestas (Bearer). Ver{" "}
              <a href="/developers" className="text-blue hover:underline">
                /developers
              </a>
              .
            </p>

            {createdKey ? (
              <div className="mb-3 rounded-ln-md border border-green/30 bg-green/10 p-4">
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
                Crear
              </Button>
            </div>

            {apiKeys.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {apiKeys.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-center justify-between rounded-ln-md border border-ln-border px-4 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{k.name}</span>{" "}
                      <code className="text-xs text-faint">{k.prefix}…</code>
                      <span className="ml-2 text-xs text-faint">
                        {k.lastUsedAt ? "usada" : "sin usar"}
                      </span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => revokeKey(k.id)}>
                      Revocar
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* webhooks */}
          <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
            <h2 className="font-semibold">Webhooks</h2>
            <p className="mb-3 mt-1 text-xs text-faint">
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
              <div className="mt-3 rounded-ln-md border border-ln-border bg-ln-bg-deep/60 p-3">
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
          </div>
        </section>
      ) : null}

      {/* ===== PERFIL ===== */}
      {tab === "profile" ? (
        <section className="mt-6 animate-ln-rise">
          <form
            onSubmit={saveProvider}
            className="max-w-lg space-y-3 rounded-ln-lg border border-ln-border bg-ln-card/60 p-5"
          >
            <h2 className="font-semibold text-ink">Tu perfil</h2>
            <p className="text-xs text-ln-faint">
              Tu nombre público y la dirección donde recibís los pagos.
            </p>
            <div>
              <label className="ln-label">Imagen del proveedor</label>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-ln-border bg-ln-card">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-xl font-bold text-ln-faint">
                      {name.slice(0, 1).toUpperCase() || "?"}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploading}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const url = await uploadFile(f);
                      if (url) setImageUrl(url);
                      e.target.value = "";
                    }}
                    className="text-xs text-ln-muted file:mr-2 file:rounded-full file:border-0 file:bg-ln-luna/15 file:px-3 file:py-1.5 file:text-ln-luna hover:file:bg-ln-luna/25"
                  />
                  {imageUrl ? (
                    <button
                      type="button"
                      onClick={() => setImageUrl("")}
                      className="self-start text-xs text-ln-faint hover:text-ln-text"
                    >
                      Quitar imagen
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-ln-faint">
                Se muestra en la ficha de tus juegos. Acordate de{" "}
                <strong>Guardar</strong>. PNG/JPG/WebP, hasta 8 MB.
              </p>
            </div>
            <div>
              <label className="ln-label">Nombre del estudio</label>
              <input
                className={`${inputCls} mt-1.5`}
                placeholder="Nombre del estudio"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="ln-label">Lightning Address</label>
              <input
                className={`${inputCls} mt-1.5 font-mono`}
                placeholder="vos@getalby.com"
                value={ln}
                onChange={(e) => setLn(e.target.value)}
              />
            </div>
            <div>
              <label className="ln-label">Mi corte de apuestas (%)</label>
              <input
                className={`${inputCls} mt-1.5`}
                type="number"
                min={0}
                max={100}
                placeholder="0"
                value={betDevFee}
                onChange={(e) => setBetDevFee(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ln-faint">
                Porcentaje del pozo que te llevás al liquidar apuestas de tus
                juegos (default para todos). Se acota al tope que fija Luna Negra y
                se suma a la comisión de la tienda. Lo podés overridear por juego.
              </p>
            </div>
            <Button type="submit">Guardar</Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
