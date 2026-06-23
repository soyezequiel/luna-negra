import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { BuyButton } from "@/components/buy-button";
import { TipButton } from "@/components/tip-button";
import { PlayButton } from "@/components/play-button";
import { GameBets } from "@/components/game-bets";
import { MultiplayerPanel } from "@/components/multiplayer-panel";
import { RegisterGame } from "@/providers/game-context";
import { ReviewsSection } from "@/components/reviews-section";
import { ActivitySection } from "@/components/activity-section";
import { GameCard } from "@/components/game-card";
import { GameMediaGallery } from "@/components/game-media-gallery";
import { GameSocialPanel } from "@/components/game-social-panel";
import {
  EditableTitle,
  EditableDescription,
  EditablePrice,
  EditableCategories,
  EditableGameUrl,
  EditableMedia,
} from "@/components/game-store-edit";
import { hueFromSlug } from "@/lib/format";
import { gameGalleryMedia } from "@/lib/game-media";
import { getPublishedGameBySlug, getRelatedGames } from "@/lib/store-catalog";
import { StoreUnavailable } from "@/components/store-unavailable";
import {
  sanitizeDescriptionHtml,
  descriptionLooksLikeHtml,
} from "@/lib/sanitize-description";

export const dynamic = "force-dynamic";

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
  if (!game) notFound();

  const session = await getSession();
  // ¿La cuenta logueada es la proveedora dueña de este juego? → mostrar el lápiz
  // de edición en la propia ficha de la tienda.
  const isOwner = Boolean(session) && game.provider.ownerId === session!.sub;
  let owned = false;
  if (session) {
    const p = await prisma.purchase.findUnique({
      where: { userId_gameId: { userId: session.sub, gameId: game.id } },
    });
    owned = p?.status === "paid";
  }
  // Solo se considera "en biblioteca" / jugable si el usuario realmente posee el
  // juego (entitlement pagado). Los juegos gratis NO son de tu propiedad hasta
  // que los agregás con "Agregar a la biblioteca" (entitlement inmediato), así
  // evitamos mostrar "✓ En tu biblioteca" a quien todavía no lo tiene.
  const canPlay = owned;

  // Modo de la ficha: biblioteca si el jugador es dueño (salvo que fuerce tienda
  // con ?view=store); si no, tienda. (Ver IMPLEMENTATION_PROMPT §3.2.)
  const mode: "store" | "library" =
    owned && sp.view !== "store" ? "library" : "store";

  const hue = hueFromSlug(game.slug);
  const media = gameGalleryMedia(game);
  // Anuncio raíz en Nostr (si existe) al que se cuelgan comentarios y reseñas.
  const root =
    game.nostrEventId && game.nostrPubkey
      ? { id: game.nostrEventId, pubkey: game.nostrPubkey }
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

      <div className="mt-6 grid gap-6 ln:[grid-template-columns:minmax(0,1fr)_340px]">
        {/* Columna izquierda: media + descripción (en móvil va debajo de la compra) */}
        <div className="order-2 min-w-0 ln:order-none">
          <EditableMedia
            gameId={game.id}
            editable={isOwner}
            coverUrl={game.coverUrl}
            horizontalCoverUrl={game.horizontalCoverUrl}
            screenshots={game.screenshots}
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
                    className="flex items-start gap-2 text-sm text-ln-text"
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

          {/* Propina opcional al dev (juegos gratis): el sat va 100% al proveedor,
              sin custodia ni comisión de la tienda. */}
          {game.priceSats === 0 ? (
            <TipButton gameId={game.id} providerName={game.provider.name} />
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
            <div className="flex justify-between py-1.5">
              <dt className="text-ln-faint">Proveedor</dt>
              <dd className="text-ln-luna">{game.provider.name}</dd>
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
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
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
