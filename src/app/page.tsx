import Link from "next/link";
import type { CSSProperties } from "react";
import LunaNegraBackground from "@/components/LunaNegraBackground";
import { GameCard } from "@/components/game-card";
import { SocialRail } from "@/components/social-rail";
import {
  CATEGORIES,
  normalizeCategories,
  normalizeCategory,
  categoryLabel,
} from "@/lib/categories";
import { hueFromSlug } from "@/lib/format";
import { normalizeImageUrl } from "@/lib/game-media";
import { getPublishedCatalog } from "@/lib/store-catalog";
import { getSession } from "@/lib/auth";
import { userSeesBetaGames } from "@/lib/beta";
import { StoreUnavailable } from "@/components/store-unavailable";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; cat?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const cat = normalizeCategory(sp.cat);
  const page = Math.max(1, Number(sp.page) || 1);

  let catalog: Awaited<ReturnType<typeof getPublishedCatalog>>;
  try {
    catalog = await getPublishedCatalog();
  } catch (err) {
    console.error("[home] no se pudo cargar el catálogo", err);
    return <StoreUnavailable />;
  }

  // Los juegos beta solo se muestran a quien activó "ver juegos beta" en su
  // perfil. El catálogo se cachea igual para todos (incluye los beta); el filtro
  // por preferencia es por usuario, así que va acá y no en la query cacheada.
  const session = await getSession();
  const seesBeta = await userSeesBetaGames(session?.sub);
  if (!seesBeta) catalog = catalog.filter((g) => !g.isBeta);

  const ql = q.toLowerCase();
  const matched = catalog.filter(
    (g) =>
      (!q || g.title.toLowerCase().includes(ql)) &&
      (!cat || normalizeCategories(g.categories).includes(cat)),
  );
  const total = matched.length;

  const ranked = [...matched].sort((a, b) => b.integration - a.integration);
  const games = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const usedCategories = new Set<string>();
  for (const g of catalog) {
    for (const c of g.categories) usedCategories.add(c);
  }
  const visibleCategories = CATEGORIES.filter((c) => usedCategories.has(c.slug));

  const cleanHome = !q && !cat && page === 1;
  const promoGames = cleanHome ? games.slice(0, Math.min(3, games.length)) : [];
  const gridGames = cleanHome ? games.slice(promoGames.length) : games;

  const linkFor = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cat) params.set("cat", cat);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  const catLink = (slug: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (slug) params.set("cat", slug);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <div className="mx-auto max-w-[1240px] px-[22px] py-8">
      {!cleanHome ? (
        <form action="/" method="get" className="mb-6 ln:hidden">
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar juegos..."
            aria-label="Buscar juegos"
            className="h-[46px] w-full rounded-full border border-ln-border bg-ln-bg-deep px-5 text-sm text-ln-text outline-none placeholder:text-ln-faint focus:ring-2 focus:ring-ln-luna/20"
          />
        </form>
      ) : null}

      {cleanHome ? (
        <section className="summer-promo-bleed relative -mt-8 mb-10 overflow-hidden">
          <div className="relative h-[430px] overflow-hidden ln:h-[500px]">
            <LunaNegraBackground
              tiempo="auto"
              densidad={0}
              velocidad={0.45}
              parallax
              animales={false}
              scrim={false}
              layeredDiaScene
              animated
            />
            <div
              className="absolute inset-0 z-[1] bg-[linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,.03)_48%,rgba(19,32,74,.36))]"
              aria-hidden
            />
            <div className="relative z-10 mx-auto flex h-[270px] max-w-[1240px] flex-col items-center px-[22px] pt-11 text-center ln:h-[305px] ln:pt-14">
              <h1 className="summer-sale-title">Edicion Hackathon la crypta</h1>
              <p className="summer-sale-subtitle">DE LUNA NEGRA</p>
              <p className="summer-sale-ribbon">
                JUEGOS WEB &middot; LIGHTNING &middot; NOSTR
              </p>
            </div>
          </div>

          {promoGames.length > 0 ? (
            <div className="relative z-20 mx-auto -mt-[126px] max-w-[1240px] px-[22px] ln:-mt-[134px]">
              <div className="relative">
                {promoGames.length > 1 ? (
                  <>
                    <span
                      className="summer-carousel-arrow left-0 ln:left-3"
                      aria-hidden
                    >
                      &lsaquo;
                    </span>
                    <span
                      className="summer-carousel-arrow right-0 ln:right-3"
                      aria-hidden
                    >
                      &rsaquo;
                    </span>
                  </>
                ) : null}

                <div className="summer-carousel-track flex snap-x justify-start gap-4 overflow-x-auto pb-3 pr-2 ln:justify-center ln:overflow-hidden ln:pb-0">
                  {promoGames.map((g) => (
                    <Link
                      key={g.id}
                      href={`/game/${g.slug}`}
                      aria-label={`Ver ${g.title}`}
                      className="summer-promo-card cover group relative block aspect-[3/4] w-[min(76vw,340px)] shrink-0 snap-center overflow-hidden rounded-[2px] bg-ln-bg-deep shadow-[0_18px_40px_rgba(0,0,0,.42)] transition-transform duration-150 hover:-translate-y-1 ln:w-[clamp(260px,23vw,360px)]"
                      style={{ "--h": hueFromSlug(g.slug) } as CSSProperties}
                    >
                      {g.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={normalizeImageUrl(g.coverUrl)}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center p-5 text-center font-display text-xl font-extrabold text-white">
                          {g.title}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="mb-8">
          <h1 className="font-display text-[40px] font-extrabold tracking-tight text-white">
            Tienda
          </h1>
          <p className="mt-2 max-w-xl text-ln-muted">
            Todo se juega en el navegador. Pagá con Lightning, conectá con Nostr.
          </p>
        </section>
      )}

      {cleanHome ? (
        <form action="/" method="get" className="mb-6 ln:hidden">
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar juegos..."
            aria-label="Buscar juegos"
            className="h-[46px] w-full rounded-full border border-ln-border bg-ln-bg-deep px-5 text-sm text-ln-text outline-none placeholder:text-ln-faint focus:ring-2 focus:ring-ln-luna/20"
          />
        </form>
      ) : null}

      <SocialRail />

      <nav className="mb-7 flex flex-wrap gap-2">
        {[{ slug: "", label: "Todas" }, ...visibleCategories].map((c) => {
          const active = (c.slug || null) === cat;
          return (
            <Link
              key={c.slug || "all"}
              href={catLink(c.slug)}
              className={cn("chip", active && "chip-on")}
            >
              {c.label}
            </Link>
          );
        })}
      </nav>

      <section id="catalogo" className="scroll-mt-24">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-[21px] font-semibold text-ln-text">
            {q
              ? `Resultados para "${q}"`
              : cat
                ? categoryLabel(cat)
                : "Catálogo"}
          </h2>
          <span className="font-mono text-xs text-ln-faint">
            {total} {total === 1 ? "juego" : "juegos"}
          </span>
        </div>

        {games.length === 0 ? (
          <p className="text-sm text-ln-faint">
            {q
              ? "No hay juegos que coincidan con tu búsqueda."
              : "Todavía no hay juegos publicados."}
          </p>
        ) : (
          <>
            {gridGames.length > 0 ? (
              <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(214px,1fr))]">
                {gridGames.map((g) => (
                  <GameCard
                    key={g.id}
                    game={{
                      slug: g.slug,
                      title: g.title,
                      coverUrl: g.coverUrl,
                      priceSats: g.priceSats,
                      categories: g.categories,
                      integration: g.integration,
                      reviewLabel: g.reviewLabel,
                    }}
                  />
                ))}
              </div>
            ) : null}

            {totalPages > 1 ? (
              <div className="mt-10 flex items-center justify-center gap-4 text-sm">
                {page > 1 ? (
                  <Link
                    href={linkFor(page - 1)}
                    className="rounded-full border border-ln-border px-4 py-2 text-ln-text transition-colors hover:bg-white/5"
                  >
                    &larr; Anterior
                  </Link>
                ) : null}
                <span className="text-ln-faint">
                  Página {page} de {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={linkFor(page + 1)}
                    className="rounded-full border border-ln-border px-4 py-2 text-ln-text transition-colors hover:bg-white/5"
                  >
                    Siguiente &rarr;
                  </Link>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
