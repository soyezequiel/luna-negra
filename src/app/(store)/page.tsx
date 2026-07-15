import Link from "next/link";
import LunaNegraBackground from "@/components/LunaNegraBackground";
import { GameCard } from "@/components/game-card";
import { FeaturedCarousel } from "@/components/featured-carousel";
import { SocialRail } from "@/components/social-rail";
import {
  CATEGORIES,
  normalizeCategories,
  normalizeCategory,
  categoryLabel,
} from "@/lib/categories";
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

  const ranked = [...matched].sort((a, b) => b.ngpActive - a.ngpActive);
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
        </section>
      ) : (
        <section className="mb-8">
          <h1 className="font-display text-[40px] font-extrabold tracking-tight text-white">
            Tienda
          </h1>
          <p className="mt-2 max-w-xl text-ln-muted">
            Todo se juega en el navegador. Pagá con Lightning e iniciá sesión en segundos.
          </p>
        </section>
      )}

      {cleanHome && promoGames.length > 0 ? (
        <section className="mb-10">
          <h2 className="mb-4 text-[21px] font-semibold text-ln-text">
            Destacados y recomendados
          </h2>
          <FeaturedCarousel
            games={promoGames.map((g) => ({
              slug: g.slug,
              title: g.title,
              coverUrl: g.coverUrl,
              horizontalCoverUrl: g.horizontalCoverUrl,
              screenshots: g.screenshots,
              videos: g.videos,
              priceSats: g.priceSats,
              categories: g.categories,
              ngpActive: g.ngpActive,
              ngpTotal: g.ngpTotal,
              ngeIntegrated: g.ngeIntegrated,
            }))}
          />
        </section>
      ) : null}

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
                {gridGames.map((g, i) => (
                  <GameCard
                    key={g.id}
                    index={i}
                    game={{
                      slug: g.slug,
                      title: g.title,
                      coverUrl: g.coverUrl,
                      horizontalCoverUrl: g.horizontalCoverUrl,
                      screenshots: g.screenshots,
                      priceSats: g.priceSats,
                      categories: g.categories,
                      ngpActive: g.ngpActive,
                      ngpTotal: g.ngpTotal,
                      ngeIntegrated: g.ngeIntegrated,
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
