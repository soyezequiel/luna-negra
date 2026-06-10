import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { BuyButton } from "@/components/buy-button";
import { PlayButton } from "@/components/play-button";
import { CreateBetButton } from "@/components/create-bet-button";
import { GameBets } from "@/components/game-bets";
import { MultiplayerPanel } from "@/components/multiplayer-panel";
import { RegisterGame } from "@/providers/game-context";
import { ReviewsSection } from "@/components/reviews-section";
import { ActivitySection } from "@/components/activity-section";
import { GameCard } from "@/components/game-card";
import { GameMediaGallery } from "@/components/game-media-gallery";
import { priceLabel, hueFromSlug } from "@/lib/format";
import { categoryLabel } from "@/lib/categories";
import { gameGalleryMedia } from "@/lib/game-media";

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
  const game = await prisma.game.findUnique({
    where: { slug },
    include: { provider: true },
  });
  if (!game || game.status !== "published") notFound();

  const session = await getSession();
  let owned = false;
  if (session) {
    const p = await prisma.purchase.findUnique({
      where: { userId_gameId: { userId: session.sub, gameId: game.id } },
    });
    owned = p?.status === "paid";
  }
  const canPlay = owned || game.priceSats === 0;

  // Modo de la ficha: biblioteca si el jugador es dueño (salvo que fuerce tienda
  // con ?view=store); si no, tienda. (Ver IMPLEMENTATION_PROMPT §3.2.)
  const mode: "store" | "library" =
    canPlay && sp.view !== "store" ? "library" : "store";

  const hue = hueFromSlug(game.slug);
  const media = gameGalleryMedia(game);
  // Anuncio raíz en Nostr (si existe) al que se cuelgan comentarios y reseñas.
  const root =
    game.nostrEventId && game.nostrPubkey
      ? { id: game.nostrEventId, pubkey: game.nostrPubkey }
      : null;
  const features = game.description
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
  const supportsRooms = Boolean(game.gameUrl);

  // Más juegos web (misma categoría, excluyendo este).
  const related = await prisma.game.findMany({
    where: {
      status: "published",
      id: { not: game.id },
      ...(game.category ? { category: game.category } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 4,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link
        href="/"
        className="text-xs uppercase tracking-wide text-faint hover:text-ink"
      >
        ← Tienda
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          {game.title}
        </h1>
        {mode === "library" ? (
          <span className="rounded-sm bg-green/15 px-2 py-1 text-xs font-semibold text-green ring-1 ring-inset ring-green/30">
            ✓ En tu biblioteca
          </span>
        ) : null}
        {game.category ? (
          <Link
            href={`/?cat=${game.category}`}
            className="rounded-sm border border-line px-2 py-0.5 text-xs text-muted hover:bg-white/5"
          >
            {categoryLabel(game.category)}
          </Link>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 lg:[grid-template-columns:minmax(0,1fr)_330px]">
        {/* Columna izquierda: media + descripción */}
        <div className="min-w-0">
          <GameMediaGallery title={game.title} hue={hue} media={media} />

          <section className="mt-8">
            <h2 className="mb-3 text-[17px] font-semibold text-ink">
              Acerca del juego
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
              {game.description || "Sin descripción."}
            </p>
            {features.length > 1 ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {features.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-ink"
                  >
                    <span className="mt-0.5 text-blue">›</span>
                    <span className="min-w-0 truncate">{f}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        {/* Columna derecha (sticky): acción + metadatos */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {mode === "library" ? (
            <div className="rounded-lg border border-green/30 bg-panel p-4 shadow-[0_0_30px_-18px_var(--green)]">
              <p className="mb-3 text-sm font-semibold text-green">
                ✓ En tu biblioteca
              </p>
              <div className="space-y-2">
                {game.gameUrl ? (
                  <PlayButton
                    gameId={game.id}
                    gameUrl={game.gameUrl}
                    title={game.title}
                    slug={game.slug}
                    variant="play"
                    size="xl"
                    className="w-full"
                  />
                ) : null}
                {game.gameUrl ? (
                  <CreateBetButton
                    gameId={game.id}
                    gameUrl={game.gameUrl}
                    title={game.title}
                    slug={game.slug}
                  />
                ) : null}
                <Link
                  href={`/game/${game.slug}?view=store`}
                  className="btn btn-blue w-full"
                >
                  Ver en la tienda
                </Link>
              </div>
              {supportsRooms ? (
                <p className="mt-3 text-center text-[11px] text-faint">
                  Compatible con salas de Luna Negra
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-line bg-panel p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wide text-faint">
                  Precio
                </span>
                <span
                  className={`font-mono text-xl font-bold ${game.priceSats === 0 ? "text-green" : "text-btc"}`}
                >
                  {priceLabel(game.priceSats)}
                </span>
              </div>
              {owned ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted">Ya está en tu biblioteca.</p>
                  <Link
                    href={`/game/${game.slug}`}
                    className="btn btn-play w-full"
                  >
                    Ir a tu biblioteca
                  </Link>
                </div>
              ) : (
                <div className="[&>button]:w-full">
                  <BuyButton
                    gameId={game.id}
                    priceSats={game.priceSats}
                    owned={false}
                    gameUrl={game.gameUrl}
                    title={game.title}
                    slug={game.slug}
                  />
                </div>
              )}
            </div>
          )}

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
          <dl className="rounded-lg border border-line bg-panel p-4 text-sm">
            <div className="flex justify-between py-1.5">
              <dt className="text-faint">Proveedor</dt>
              <dd className="text-blue">{game.provider.name}</dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-faint">Modos</dt>
              <dd className="text-ink">
                {supportsRooms ? "1 jugador · 1v1" : "1 jugador"}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-faint">Lanzamiento</dt>
              <dd className="text-ink">
                {game.createdAt.toLocaleDateString("es-AR")}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-faint">Plataforma</dt>
              <dd className="text-ink">Web · Lightning</dd>
            </div>
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
          <h2 className="mb-4 text-[17px] font-semibold text-ink">
            Más juegos web
          </h2>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
            {related.map((g) => (
              <GameCard
                key={g.id}
                game={{
                  slug: g.slug,
                  title: g.title,
                  coverUrl: g.coverUrl,
                  priceSats: g.priceSats,
                  category: g.category,
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
