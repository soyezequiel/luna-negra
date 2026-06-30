import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { BuyButton } from "@/components/buy-button";
import { ZapButton } from "@/components/zap-button";
import { ZapLeaderboard } from "@/components/zap-leaderboard";
import { PlayButton } from "@/components/play-button";
import { LibraryButton } from "@/components/library-button";
import { GameBets } from "@/components/game-bets";
import { MultiplayerPanel } from "@/components/multiplayer-panel";
import { RegisterGame } from "@/providers/game-context";
import { ReviewsSection } from "@/components/reviews-section";
import { ActivitySection } from "@/components/activity-section";
import { GameCard } from "@/components/game-card";
import { GameMediaGallery } from "@/components/game-media-gallery";
import { GameSocialPanel } from "@/components/game-social-panel";
import { ShareNostrButton } from "@/components/share-nostr-button";
import {
  EditableTitle,
  EditableDescription,
  EditablePrice,
  EditableCategories,
  EditableGameUrl,
  EditableMedia,
} from "@/components/game-store-edit";
import { hueFromSlug } from "@/lib/format";
import {
  gameGalleryMedia,
  normalizeImageUrl,
  parseScreenshotUrls,
} from "@/lib/game-media";
import { getPublishedGameBySlug, getRelatedGames } from "@/lib/store-catalog";
import { ADMIN_ONLY_STATUS, canViewHiddenGame } from "@/lib/admin";
import { normalizeCategories } from "@/lib/categories";
import { SITE_URL } from "@/lib/site";
import { StoreUnavailable } from "@/components/store-unavailable";
import {
  sanitizeDescriptionHtml,
  descriptionLooksLikeHtml,
} from "@/lib/sanitize-description";

export const dynamic = "force-dynamic";

// Texto plano para la descripción del preview: saca etiquetas HTML, colapsa
// espacios y recorta. La descripción puede venir como HTML enriquecido o texto.
function plainDescription(raw: string, max = 200): string {
  const text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

// Metadatos por juego: cuando alguien comparte el link de la ficha (WhatsApp,
// Discord, X, Telegram…), el título del preview es "Juego — Proveedor" y se
// adjunta la portada como imagen. Reutiliza la lectura cacheada de la ficha.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  let game: Awaited<ReturnType<typeof getPublishedGameBySlug>> = null;
  try {
    game = await getPublishedGameBySlug(slug);
  } catch {
    game = null;
  }
  if (!game) {
    return { title: "Juego no encontrado · Luna Negra" };
  }

  const title = `${game.title} — ${game.provider.name}`;
  const description = plainDescription(game.description) || `${game.title} en Luna Negra.`;
  const cover = normalizeImageUrl(game.coverUrl || game.horizontalCoverUrl);
  const images = cover ? [cover] : undefined;
  const url = `${SITE_URL}/game/${game.slug}`;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    openGraph: {
      type: "website",
      siteName: "Luna Negra",
      url,
      title,
      description,
      images,
    },
    twitter: {
      // Carátula vertical → card "summary" (miniatura al costado). Con
      // "summary_large_image" (banner ~1.91:1) Discord/X descartan la imagen
      // portrait y no muestran nada.
      card: "summary",
      title,
      description,
      images,
    },
  };
}

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; room?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  // Lectura cacheada (no depende de la sesión): para visitas anónimas/bots la
  // ficha no toca Neon. La compra/entitlement sí es por usuario (más abajo).
  let game: Awaited<ReturnType<typeof getPublishedGameBySlug>>;
  try {
    game = await getPublishedGameBySlug(slug);
  } catch (err) {
    console.error("[game] no se pudo cargar la ficha", err);
    return <StoreUnavailable />;
  }

  const session = await getSession();

  // Juego oculto (admin_only): no está en el catálogo cacheado, así que la lectura
  // de arriba devuelve null. Lo cargamos sin caché y solo lo mostramos si el
  // visitante es el admin o el proveedor dueño; para cualquier otro es un 404.
  let isHidden = false;
  if (!game && session) {
    // Solo vale la pena consultar si hay sesión (anónimo nunca puede ver ocultos).
    try {
      const hidden = await prisma.game.findUnique({
        where: { slug },
        include: { provider: true },
      });
      if (
        hidden &&
        hidden.status === ADMIN_ONLY_STATUS &&
        canViewHiddenGame(session.pubkey, session.sub, hidden.provider.ownerId)
      ) {
        game = { ...hidden, categories: normalizeCategories(hidden.categories) };
        isHidden = true;
      }
    } catch (err) {
      console.error("[game] no se pudo cargar la ficha oculta", err);
      return <StoreUnavailable />;
    }
  }
  if (!game) notFound();

  // ¿La cuenta logueada es la proveedora dueña de este juego? → mostrar el lápiz
  // de edición en la propia ficha de la tienda.
  const isOwner = Boolean(session) && game.provider.ownerId === session!.sub;
  let owned = false;
  // ¿El entitlement es gratuito (amountSats 0)? Solo esos se pueden "quitar de la
  // biblioteca"; un juego pagado con sats no se quita para no perder el acceso.
  let ownedFree = false;
  if (session) {
    const p = await prisma.purchase.findUnique({
      where: { userId_gameId: { userId: session.sub, gameId: game.id } },
    });
    owned = p?.status === "paid";
    ownedFree = owned && p!.amountSats === 0;
  }
  // Solo se considera "en biblioteca" / jugable si el usuario realmente posee el
  // juego (entitlement pagado). Los juegos gratis NO son de tu propiedad hasta
  // que los agregás con "Agregar a la biblioteca" (entitlement inmediato), así
  // evitamos mostrar "✓ En tu biblioteca" a quien todavía no lo tiene.
  // En un juego oculto el admin/dueño puede jugar aunque no lo haya agregado (el
  // token de sesión se lo da igual), así que también puede lanzarlo.
  const canPlay = owned || isHidden;

  // Modo de la ficha: biblioteca si el jugador es dueño (salvo que fuerce tienda
  // con ?view=store); si no, tienda. (Ver IMPLEMENTATION_PROMPT §3.2.)
  const mode: "store" | "library" =
    owned && sp.view !== "store" ? "library" : "store";

  const hue = hueFromSlug(game.slug);
  const media = gameGalleryMedia(game);
  // Artículo NIP-23 del juego (si existe) al que se cuelgan comentarios y reseñas.
  // `coord` (cuando está) es el enlace estable entre ediciones.
  const root =
    game.nostrEventId && game.nostrPubkey
      ? {
          id: game.nostrEventId,
          pubkey: game.nostrPubkey,
          coord: game.nostrCoord,
        }
      : null;
  // La descripción puede ser HTML enriquecido (ficha estilo Steam) o texto
  // plano. Si es HTML lo saneamos y lo renderizamos tal cual; si es texto
  // plano mantenemos la lista de "características" (una por línea).
  const isHtmlDescription = descriptionLooksLikeHtml(game.description);
  const descriptionHtml = isHtmlDescription
    ? sanitizeDescriptionHtml(game.description)
    : "";
  const features = isHtmlDescription
    ? []
    : game.description
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 6);
  const supportsRooms = Boolean(game.gameUrl);

  // Media para adjuntar al compartir en Nostr: carátula(s) + capturas, en URL
  // ABSOLUTA (las notas las consumen clientes externos, una ruta /uploads
  // relativa no resolvería). Carátula primero (es la que va seleccionada por
  // defecto). Deduplicado y acotado a 4.
  const shareImages = (() => {
    const candidates = [
      game.horizontalCoverUrl,
      game.coverUrl,
      ...parseScreenshotUrls(game.screenshots),
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of candidates) {
      const n = normalizeImageUrl(raw);
      if (!n) continue;
      const abs = /^https?:\/\//i.test(n)
        ? n
        : `${SITE_URL}${n.startsWith("/") ? "" : "/"}${n}`;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
    }
    return out.slice(0, 4);
  })();

  // Más juegos web (que compartan alguna categoría, excluyendo este). Cacheado;
  // si Neon falla acá no tiramos la ficha entera, solo omitimos la sección.
  let related: Awaited<ReturnType<typeof getRelatedGames>> = [];
  try {
    related = await getRelatedGames(game.id, game.categories);
  } catch (err) {
    console.error("[game] no se pudieron cargar los relacionados", err);
  }

  return (
    <div className="mx-auto max-w-[1240px] px-[22px] py-8">
      <Link
        href="/"
        className="ln-label transition-colors hover:text-ln-text"
      >
        ← Tienda
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <EditableTitle gameId={game.id} editable={isOwner} value={game.title}>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            {game.title}
          </h1>
        </EditableTitle>
        {isHidden ? (
          <span className="rounded-full bg-btc/15 px-2.5 py-1 text-xs font-semibold text-btc ring-1 ring-inset ring-btc/40">
            🔒 Solo admin · oculto
          </span>
        ) : null}
        {mode === "library" ? (
          <span className="rounded-full bg-ln-aurora/15 px-2.5 py-1 text-xs font-semibold text-ln-aurora ring-1 ring-inset ring-ln-aurora/30">
            ✓ En tu biblioteca
          </span>
        ) : null}
        <EditableCategories
          gameId={game.id}
          editable={isOwner}
          value={game.categories}
        />
      </div>

      {/* Autoría: imagen del proveedor + nombre del estudio. */}
      <div className="mt-2.5 flex items-center gap-2.5 text-sm text-ln-muted">
        <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border border-ln-border bg-ln-card">
          {game.provider.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={game.provider.imageUrl}
              alt={game.provider.name}
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-[12px] font-bold text-ln-faint">
              {game.provider.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <span>
          por{" "}
          <span className="font-medium text-ln-luna">{game.provider.name}</span>
        </span>
      </div>

      <div className="mt-6 grid gap-6 ln:[grid-template-columns:minmax(0,1fr)_340px]">
        {/* Columna izquierda: media + descripción (en móvil va debajo de la compra) */}
        <div className="order-2 min-w-0 ln:order-none">
          <EditableMedia
            gameId={game.id}
            editable={isOwner}
            coverUrl={game.coverUrl}
            horizontalCoverUrl={game.horizontalCoverUrl}
            screenshots={game.screenshots}
            videos={game.videos}
          >
            <GameMediaGallery title={game.title} hue={hue} media={media} />
          </EditableMedia>

          <section className="mt-8">
            <h2 className="mb-3 text-[19px] font-semibold text-ln-text">
              Acerca del juego
            </h2>
            <EditableDescription
              gameId={game.id}
              editable={isOwner}
              value={game.description}
              isHtml={isHtmlDescription}
              html={descriptionHtml}
            />
            {features.length > 1 ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {features.map((f, i) => (
                  <li
                    key={i}
                    className="flex min-w-0 items-start gap-2 text-sm text-ln-text"
                  >
                    <span className="mt-0.5 text-ln-luna">›</span>
                    <span className="min-w-0 truncate">{f}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        {/* Columna derecha (sticky): acción + social + metadatos. En móvil, primero. */}
        <aside className="order-1 space-y-4 ln:order-none ln:sticky ln:top-[86px] ln:self-start">
          {mode === "library" ? (
            <div className="rounded-ln-lg border border-ln-aurora/30 bg-ln-card p-4 shadow-ln-aurora">
              <p className="mb-3 text-sm font-semibold text-ln-aurora-bright">
                ✓ En tu biblioteca
              </p>
              <div className="space-y-2 [&>*]:w-full">
                {game.gameUrl ? (
                  <PlayButton
                    gameId={game.id}
                    gameUrl={game.gameUrl}
                    title={game.title}
                    slug={game.slug}
                    label="▶ Jugar"
                    variant="play"
                    size="xl"
                    className="w-full"
                  />
                ) : null}
                <Link
                  href={`/game/${game.slug}?view=store`}
                  className="btn btn-ghost w-full"
                >
                  Ver en la tienda
                </Link>
                {ownedFree ? (
                  <LibraryButton
                    gameId={game.id}
                    owned
                    variant="ghost"
                    size="sm"
                  />
                ) : null}
              </div>
              {supportsRooms ? (
                <p className="mt-3 text-center text-[11px] text-ln-faint">
                  Compatible con salas de Luna Negra
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-ln-lg border border-ln-corona/40 bg-ln-card p-5 shadow-ln-corona">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <span className="ln-label">Precio</span>
                <EditablePrice
                  gameId={game.id}
                  editable={isOwner}
                  value={game.priceSats}
                />
              </div>
              {owned ? (
                <div className="space-y-2">
                  <p className="text-sm text-ln-muted">
                    Ya está en tu biblioteca.
                  </p>
                  <Link
                    href={`/game/${game.slug}`}
                    className="btn btn-aurora w-full"
                  >
                    Ir a tu biblioteca
                  </Link>
                </div>
              ) : isHidden ? (
                // Juego oculto (admin_only): no se compra. El admin/dueño lo
                // agrega a su biblioteca (entitlement gratis) y puede jugarlo ya.
                <div className="space-y-2 [&>*]:w-full">
                  {game.gameUrl ? (
                    <PlayButton
                      gameId={game.id}
                      gameUrl={game.gameUrl}
                      title={game.title}
                      slug={game.slug}
                      label="▶ Jugar"
                      variant="play"
                      size="xl"
                    />
                  ) : null}
                  <LibraryButton gameId={game.id} owned={false} variant="luna" />
                </div>
              ) : (
                <div className="space-y-2 [&>button]:w-full">
                  <BuyButton
                    gameId={game.id}
                    priceSats={game.priceSats}
                    owned={false}
                    gameUrl={game.gameUrl}
                    title={game.title}
                    slug={game.slug}
                  />
                  <button
                    type="button"
                    className="w-full rounded-full border border-ln-border px-4 py-2 text-[13px] text-ln-soft transition-colors hover:bg-white/5"
                  >
                    + Agregar a deseados
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Acciones sociales compactas: compartir en Nostr (nota firmada por
              el usuario con el link a la tienda) y, en juegos gratis con anuncio
              en Nostr, el zap al dev (propina NIP-57, el sat va 100% al dev).
              Van en una sola fila para no comer espacio en la columna sticky. */}
          <div className="flex flex-wrap gap-2">
            <ShareNostrButton
              slug={game.slug}
              title={game.title}
              shareUrl={`${SITE_URL}/game/${game.slug}`}
              images={shareImages}
              root={root}
              className="min-w-[140px] flex-1"
            />
            {game.priceSats === 0 && game.nostrEventId ? (
              <ZapButton
                gameId={game.id}
                providerName={game.provider.name}
                className="min-w-[140px] flex-1"
              />
            ) : null}
          </div>

          {/* Top de zappers del juego (sale de los recibos 9735 verificados). */}
          {game.priceSats === 0 && game.nostrEventId ? (
            <ZapLeaderboard scope="game" gameId={game.id} />
          ) : null}

          {/* Panel social "Jugá con amigos" (juegos con salas y comprables) */}
          {supportsRooms && canPlay ? <GameSocialPanel /> : null}

          {/* Sala por invitación (link ?room=...) */}
          {game.gameUrl && canPlay ? (
            <Suspense fallback={null}>
              <RegisterGame
                gameId={game.id}
                slug={game.slug}
                title={game.title}
                gameUrl={game.gameUrl}
                nostrCoord={game.nostrCoord}
                supportsChallenges={game.supportsChallenges}
              />
              <MultiplayerPanel
                gameId={game.id}
                slug={game.slug}
                title={game.title}
                gameUrl={game.gameUrl}
                canPlay={canPlay}
              />
            </Suspense>
          ) : null}

          {/* Metadatos */}
          <dl className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4 text-sm">
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-ln-faint">Proveedor</dt>
              <dd className="flex items-center gap-2 text-ln-luna">
                {game.provider.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={game.provider.imageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-5 w-5 rounded-full border border-ln-border object-cover"
                  />
                ) : null}
                {game.provider.name}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-ln-faint">Modos</dt>
              <dd className="text-ln-text">
                {supportsRooms ? "1 jugador · 1v1" : "1 jugador"}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-ln-faint">Lanzamiento</dt>
              <dd className="text-ln-text">
                {new Date(game.createdAt).toLocaleDateString("es-AR")}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-ln-faint">Plataforma</dt>
              <dd className="text-ln-text">Web · Lightning</dd>
            </div>
            {isOwner ? (
              <EditableGameUrl gameId={game.id} value={game.gameUrl} />
            ) : null}
          </dl>
        </aside>
      </div>

      {/* Modo tienda → Reseñas. Modo biblioteca → Tus apuestas + Comentarios. */}
      {mode === "store" ? (
        <ReviewsSection
          gameId={game.id}
          owned={owned}
          title={game.title}
          slug={game.slug}
          root={root}
        />
      ) : (
        <div className="mt-10 grid gap-8 ln:grid-cols-2">
          <GameBets gameId={game.id} title={game.title} />
          <ActivitySection slug={game.slug} title={game.title} root={root} />
        </div>
      )}

      {related.length > 0 ? (
        <section className="mt-12">
          <h2 className="mb-4 text-[19px] font-semibold text-ln-text">
            Más juegos web
          </h2>
          <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
            {related.map((g) => (
              <GameCard
                key={g.id}
                game={{
                  slug: g.slug,
                  title: g.title,
                  coverUrl: g.coverUrl,
                  priceSats: g.priceSats,
                  categories: g.categories,
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
