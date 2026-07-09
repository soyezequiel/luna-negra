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
import { NgeCredentialCard } from "@/components/provider/nge-credential-card";
import {
  signAndMigrateArticle,
  signAndPushArticle,
  signAndSubmit,
  signGameDeletion,
} from "@/lib/game-article-client";
import { gameArticleNaddrFromCoord } from "@/lib/game-article";
import { RELAYS } from "@/lib/constants";

// URL de njump.me (gateway web de Nostr) para abrir el artículo del juego en
// cualquier cliente. njump resuelve el `naddr1…` y ofrece abrirlo en el cliente
// preferido del usuario. null si el juego todavía no tiene artículo en Nostr.
function gameNjumpUrl(coord: string | null): string | null {
  // Pistas de relay (los primeros de la lista) para que njump/el cliente
  // encuentren el evento aunque no lo tengan cacheado.
  const naddr = gameArticleNaddrFromCoord(coord, RELAYS.slice(0, 3));
  return naddr ? `https://njump.me/${naddr}` : null;
}

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
  // Régimen del artículo NIP-23: "provider" = lo firma el proveedor en el
  // navegador; "store" = legacy (lo firma la tienda server-side).
  articleSigner: string;
  // Evento 30023 firmado pendiente de difusión (submit → el admin lo publica).
  signedArticle: unknown;
  // La ficha publicada tiene cambios sin firmar/difundir en Nostr.
  articleDirty: boolean;
  nostrEventId: string | null;
  nostrCoord: string | null;
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

export default function ProviderPage() {
  const { user, login, loading } = useSession();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [betEarnings, setBetEarnings] = useState<{
    totalSats: number;
    settledSats: number;
    pendingSats: number;
    failedSats: number;
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Juego al que emitir la credencial NGE ("" = primer juego).
  const [envGameId, setEnvGameId] = useState("");

  const [tab, setTab] = useState<Tab>("games");
  const [showNewGame, setShowNewGame] = useState(false);
  // Adoptar un artículo NIP-23 ya publicado (naddr1… o coordenada cruda).
  const [showAdopt, setShowAdopt] = useState(false);
  const [adoptAddress, setAdoptAddress] = useState("");

  const [name, setName] = useState("");
  const [ln, setLn] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [betDevFee, setBetDevFee] = useState("0");

  const [newForm, setNewForm] = useState<GameForm>({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<GameForm>({ ...emptyForm });
  const [uploading, setUploading] = useState(false);
  const [, startLoadTransition] = useTransition();

  const load = useCallback(async () => {
    const [d, s, e] = await Promise.all([
      fetch("/api/provider").then((r) => r.json()).catch(() => null),
      fetch("/api/provider/sales").then((r) => r.json()).catch(() => ({ sales: [] })),
      fetch("/api/provider/earnings").then((r) => r.json()).catch(() => ({ earnings: null })),
    ]);
    if (d?.provider) {
      setProvider(d.provider);
      setName(d.provider.name);
      setImageUrl(d.provider.imageUrl ?? "");
      setLn(d.provider.lightningAddress ?? "");
      setBetDevFee(String(d.provider.betDevFeePct ?? 0));
    }
    setGames(d?.games ?? []);
    setSales(s?.sales ?? []);
    setBetEarnings(e?.earnings ?? null);
  }, []);

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
    const gameId = editingId;
    const payload = { ...editForm, priceSats: Number(editForm.priceSats) };
    const r = await fetch(`/api/provider/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "Error");
    setMsg("Cambios guardados.");
    cancelEdit();
    // Juego publicado provider-firmado: el server no puede re-firmar el artículo;
    // encadenamos la firma acá (si el usuario cancela, queda el botón "Firmar y
    // difundir" en la tarjeta — articleDirty lo hace visible).
    if (d.needsSignature) {
      try {
        setMsg("Cambios guardados. Firmá el artículo para publicarlos en Nostr…");
        await signAndPushArticle(gameId);
        setMsg("Cambios guardados y publicados en Nostr.");
      } catch (err) {
        setMsg(
          `Cambios guardados, pero falta firmar el artículo: ${
            err instanceof Error ? err.message : "firma cancelada"
          }. Usá "Firmar y difundir" en la tarjeta del juego.`,
        );
      }
    }
    load();
  }

  // "Enviar a revisión" del régimen provider: firma el artículo con el Nostr del
  // proveedor y lo adjunta al submit (el admin lo difunde al aprobar).
  async function submitWithSignature(id: string) {
    setMsg("Firmá el artículo del juego con tu Nostr…");
    try {
      await signAndSubmit(id);
      setMsg("Artículo firmado y enviado a revisión. Te avisamos cuando se apruebe.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo firmar el artículo");
    }
    load();
  }

  // Re-firma el artículo: repone una firma invalidada (in_review) o difunde los
  // cambios pendientes de un juego publicado (articleDirty).
  async function resignArticle(id: string) {
    setMsg("Firmá el artículo del juego con tu Nostr…");
    try {
      await signAndPushArticle(id);
      setMsg("Artículo firmado.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo firmar el artículo");
    }
    load();
  }

  // Migra un juego legacy (artículo firmado por la tienda) a la cuenta del
  // proveedor. La coordenada cambia: la actividad histórica no migra.
  async function migrateArticle(id: string) {
    if (
      !confirm(
        "Migrar la publicación a tu cuenta re-publica el artículo del juego firmado por tu Nostr.\n\n" +
          "⚠️ La coordenada del juego CAMBIA: los puntajes, reseñas y presencia anclados a la coordenada vieja no migran, " +
          "y los juegos integrados deben re-leer gameCoord en su próxima sesión.\n\n¿Continuar?",
      )
    ) {
      return;
    }
    setMsg("Firmá el artículo del juego con tu Nostr…");
    try {
      await signAndMigrateArticle(id);
      setMsg("Publicación migrada a tu cuenta: el artículo ahora lo firma tu Nostr.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo migrar la publicación");
    }
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
    const game = games.find((g) => g.id === id);
    const hasArticle =
      game?.articleSigner === "provider" && game?.nostrEventId != null;
    if (
      !confirm(
        hasArticle
          ? "¿Borrar este juego? No se puede deshacer.\nSe intentará retirar también el artículo de Nostr (kind:5 firmado por vos)."
          : "¿Borrar este juego? No se puede deshacer.",
      )
    ) {
      return;
    }
    // Retractación NIP-09 best-effort: si el usuario cancela la firma o no hay
    // signer, se borra igual solo de la DB (el server lo trata como opcional).
    let deleteEvent: unknown = null;
    if (hasArticle && game) {
      deleteEvent = await signGameDeletion({
        nostrEventId: game.nostrEventId,
        nostrCoord: game.nostrCoord,
      });
    }
    const r = await fetch(`/api/provider/games/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deleteEvent ? { deleteEvent } : {}),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error ?? "No se pudo borrar");
    load();
  }

  // Adopta un artículo NIP-23 ya publicado en Nostr (firmado por la cuenta del
  // proveedor): pega el naddr1…/coordenada y Luna lo importa como juego en
  // revisión, con la identidad Nostr del artículo original.
  async function adoptArticle(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await fetch("/api/provider/games/adopt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: adoptAddress }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error ?? "No se pudo adoptar el artículo");
    setMsg(
      "Artículo adoptado: quedó en revisión con su coordenada Nostr original. Te avisamos cuando se apruebe.",
    );
    setAdoptAddress("");
    setShowAdopt(false);
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
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label="Ingresos por ventas" value={satsLabel(paidSats)} sub={`${satsLabel(pendingSats)} sats por cobrar`} accent="var(--btc)" />
        <Kpi
          label="Ganado en apuestas"
          value={satsLabel(betEarnings?.totalSats ?? 0)}
          sub={
            betEarnings
              ? `${satsLabel(betEarnings.settledSats)} cobrados · ${satsLabel(betEarnings.pendingSats)} por cobrar`
              : "tu corte (dev_fee)"
          }
          accent="var(--win)"
        />
        <Kpi label="Juegos publicados" value={String(publishedCount)} sub={`${games.length} en total · ${sales.length} ventas`} accent="var(--blue)" />
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
                        Todavía no es visible — envialo a revisión
                        {g.articleSigner === "provider"
                          ? " (vas a firmar el artículo con tu Nostr)"
                          : ""}
                        .
                      </p>
                    ) : null}
                    {/* Estado de la firma del artículo (régimen provider). */}
                    {g.articleSigner === "provider" && g.status === "in_review" ? (
                      g.signedArticle != null ? (
                        <p className="mt-1 text-[11px] text-ln-aurora">
                          Artículo firmado — esperando revisión.
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-ln-corona">
                          Falta tu firma: sin ella el admin no puede aprobarlo.
                        </p>
                      )
                    ) : null}
                    {g.articleSigner === "provider" &&
                    g.status === "published" &&
                    g.articleDirty ? (
                      <p className="mt-1 text-[11px] text-ln-corona">
                        Hay cambios sin firmar en Nostr.
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
                            g.articleSigner === "provider"
                              ? submitWithSignature(g.id)
                              : action(
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
                      {/* Reponer una firma invalidada (in_review sin firma). */}
                      {g.articleSigner === "provider" &&
                      g.status === "in_review" &&
                      g.signedArticle == null ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resignArticle(g.id)}
                        >
                          Firmar artículo
                        </Button>
                      ) : null}
                      {/* Difundir cambios pendientes de un publicado (dirty). */}
                      {g.articleSigner === "provider" &&
                      g.status === "published" &&
                      g.articleDirty ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resignArticle(g.id)}
                        >
                          Firmar y difundir
                        </Button>
                      ) : null}
                      {/* Migración legacy → cuenta del proveedor. */}
                      {g.articleSigner === "store" && g.status === "published" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => migrateArticle(g.id)}
                        >
                          Migrar a mi Nostr
                        </Button>
                      ) : null}
                      {/* Abrir la publicación en un cliente Nostr cualquiera
                          (njump.me). Solo si ya tiene artículo en Nostr. */}
                      {gameNjumpUrl(g.nostrCoord) ? (
                        <a
                          href={gameNjumpUrl(g.nostrCoord)!}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-ghost px-3.5 py-1.5 text-[13px]"
                          title="Abrir el artículo del juego en un cliente Nostr (njump.me)"
                        >
                          Ver en Nostr ↗
                        </a>
                      ) : null}
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
              {/* Adoptar un artículo NIP-23 ya publicado en Nostr (firmado por
                  la cuenta del proveedor): Luna lo agrega a la tienda con su
                  coordenada original, previa revisión del admin. */}
              {showAdopt ? (
                <form
                  onSubmit={adoptArticle}
                  className="flex min-h-[118px] flex-col justify-center gap-2 rounded-ln-lg border border-dashed border-blue/35 bg-blue/[.04] p-3.5"
                >
                  <p className="text-[12px] font-semibold text-blue">
                    Adoptar artículo Nostr existente
                  </p>
                  <input
                    className={inputCls}
                    placeholder="naddr1… o 30023:<pubkey>:<slug>"
                    value={adoptAddress}
                    onChange={(e) => setAdoptAddress(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={!adoptAddress.trim()}>
                      Adoptar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAdopt(false)}
                    >
                      Cancelar
                    </Button>
                  </div>
                  <p className="text-[10.5px] leading-snug text-ln-faint">
                    El artículo debe estar firmado por tu cuenta Nostr. Se importa
                    con su coordenada original y pasa por revisión.
                  </p>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAdopt(true)}
                  className="flex min-h-[118px] flex-col items-center justify-center gap-2 rounded-ln-lg border border-dashed border-blue/35 bg-blue/[.04] text-[14px] font-semibold text-blue transition-colors hover:bg-blue/10"
                >
                  <span className="text-[22px] leading-none">⚡</span>
                  Adoptar artículo Nostr existente
                </button>
              )}
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
          {/* Protagonista: NGP + NGE */}
          <div className="rounded-ln-lg border border-ln-luna/30 bg-ln-card/60 p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-ink">
                Nostr Games Protocol (NGP) + NGE
              </h2>
              <span className="rounded-full bg-ln-luna/15 px-2 py-0.5 text-[10px] font-semibold text-ln-luna">
                Estándar
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-faint">
              El estándar para integrar tu juego. <strong>NGP</strong> (presencia
              NIP-38, marcador <code>kind:31337</code>, retos NIP-17, reseñas
              NIP-23, zaps) <strong>no necesita variables de entorno ni API key</strong>:
              el login es NIP-07/46 (el jugador firma con su propio signer) y los
              eventos se anclan al <code>gameCoord</code> del juego, que obtenés de
              los relays (<code>{"{ kinds:[30023], \"#d\":[\"<slug>\"] }"}</code>) o
              hardcodeás. Para <strong>apuestas y escrow</strong> usá{" "}
              <strong>NGE</strong>: una sola credencial (<code>NGE_CONNECTION</code>)
              por juego, más abajo — sin exponer nada en relays públicos.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/provider/integracion" className="btn btn-outline">
                Ver estado de integración
              </Link>
              <Link href="/dev" className="btn btn-ghost">
                Guía /dev
              </Link>
              <a href="/developers" className="btn btn-ghost">
                Referencia interactiva
              </a>
            </div>
          </div>

          {/* credencial NGE (apuestas por eventos, por juego) — protagonista */}
          {games.length > 1 ? (
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted lg:col-span-2">
              Credencial NGE para el juego:
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

          {selectedGameId ? (
            <div className="lg:col-span-2">
              <NgeCredentialCard gameId={selectedGameId} />
            </div>
          ) : (
            <p className="text-sm text-ln-faint lg:col-span-2">
              Creá un juego para emitir su credencial NGE.
            </p>
          )}

          {/* Retrocompatibilidad: interfaz 1.0 (REST) detrás de un botón */}
          <div className="rounded-ln-lg border border-dashed border-ln-corona/35 bg-ln-corona/[.04] p-5 lg:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">
                    Interfaz 1.0 (REST) · compatibilidad
                  </h3>
                  <span className="rounded-full bg-ln-corona/15 px-2 py-0.5 text-[10px] font-semibold text-ln-corona">
                    Se dejará de usar
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-faint">
                  Variables de entorno, claves de API y webhooks server-to-server.
                  Se mantiene para las integraciones que ya la usan, pero{" "}
                  <strong>no es recomendable para juegos nuevos</strong>: migrá a
                  NGP/NGE cuando puedas.
                </p>
              </div>
              <Link
                href="/provider/integracion/compat"
                className="btn btn-outline shrink-0 self-start sm:self-center"
              >
                Ver interfaz 1.0
              </Link>
            </div>
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
