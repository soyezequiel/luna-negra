import Link from "next/link";
import { GameCard } from "@/components/game-card";
import { SocialRail } from "@/components/social-rail";
import LunaNegraBackground from "@/components/LunaNegraBackground";
import { SITE_TAGLINE } from "@/lib/site";
import {
  CATEGORIES,
  normalizeCategories,
  normalizeCategory,
  categoryLabel,
} from "@/lib/categories";
import { getPublishedCatalog } from "@/lib/store-catalog";
import { getPlayingNowCount } from "@/lib/playing-now";
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

  // Catálogo publicado servido desde el Data Cache (ver store-catalog.ts): ya viene
  // ordenado por más reciente y con el score de integración por juego. Filtramos,
  // rankeamos y paginamos en memoria para no tocar Neon en cada render del Home.
  let catalog: Awaited<ReturnType<typeof getPublishedCatalog>>;
  try {
    catalog = await getPublishedCatalog();
  } catch (err) {
    console.error("[home] no se pudo cargar el catálogo", err);
    return <StoreUnavailable />;
  }
  const ql = q.toLowerCase();
  const matched = catalog.filter(
    (g) =>
      (!q || g.title.toLowerCase().includes(ql)) &&
      (!cat || normalizeCategories(g.categories).includes(cat)),
  );
  const total = matched.length;

  // Prioridad: más interfaces de Luna Negra integradas → más arriba. Empate por
  // más reciente (el catálogo ya viene ordenado por nuevo primero, sort estable).
  const ranked = [...matched].sort((a, b) => b.integration - a.integration);
  const games = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Categorías con al menos un juego publicado: las vacías no se muestran en los
  // chips. Se deriva del catálogo completo (no del filtrado por búsqueda) para que
  // la lista de filtros refleje todo el inventario de la tienda.
  const usedCategories = new Set<string>();
  for (const g of catalog) {
    for (const c of g.categories) usedCategories.add(c);
  }
  const visibleCategories = CATEGORIES.filter((c) => usedCategories.has(c.slug));

  // Hero de marca con la escena animada de selva: sólo en la portada limpia (sin
  // búsqueda ni filtro, página 1). En búsquedas/otras páginas no aparece para no
  // robar espacio a los resultados.
  const showHero = !q && !cat && page === 1;
  const gridGames = games;

  // Conteo "jugando ahora" para el badge del hero. Sólo se consulta cuando hay
  // hero; tolerante a fallos (cold start de la DB) → 0, que oculta el pill.
  const playingNow = showHero ? await getPlayingNowCount().catch(() => 0) : 0;

  const linkFor = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (cat) params.set("cat", cat);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  // Link de un chip de categoría: setea cat (o la limpia con ""), preserva q, resetea page.
  const catLink = (slug: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (slug) params.set("cat", slug);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <>
      {/* Hero de marca full-bleed: escena animada de selva (canvas) a sangre,
          alto, con la navbar transparente encima (navbar.tsx detecta #home-hero
          para volverse transparente mientras el hero está bajo ella). El canvas
          se posiciona absoluto y llena la sección; el contenido va en z-10
          centrado al mismo ancho que el catálogo. El borde inferior rasgado
          (mask.png) funde con la textura de la página. */}
      {showHero ? (
        <section
          id="home-hero"
          className="relative -mt-[66px] animate-ln-rise overflow-hidden"
        >
          <LunaNegraBackground densidad={48} />
          <div className="relative z-10 mx-auto flex min-h-[92svh] w-full max-w-[1240px] flex-col justify-end gap-4 px-6 pb-16 pt-[96px] ln:px-[22px] ln:pb-24">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="ln-label rounded-full bg-black/45 px-2.5 py-1 !text-ln-corona-bright backdrop-blur-sm">
                ★ Destacado
              </span>
              {playingNow > 0 ? (
                <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[12px] font-medium text-ln-soft backdrop-blur-sm">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-ln-aurora shadow-[0_0_8px] shadow-ln-aurora"
                    aria-hidden
                  />
                  {playingNow.toLocaleString("es-AR")} jugando ahora
                </span>
              ) : null}
            </div>

            <h1 className="max-w-[12ch] font-display text-[46px] font-extrabold leading-[1.0] tracking-tight text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.55)] ln:text-[72px]">
              Tu próxima aventura ya empezó
            </h1>

            <p className="max-w-[460px] text-[15px] leading-relaxed text-ln-soft drop-shadow-[0_1px_10px_rgba(0,0,0,0.6)] ln:text-base">
              Miles de juegos para PC, directo en tu navegador. Pagá con
              Lightning y jugá con amigos por Nostr.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-4">
              <Link href="#catalogo" className="btn btn-luna btn-xl shadow-ln-luna">
                ▶ Explorar la tienda
              </Link>
              <span className="font-mono text-sm text-ln-soft drop-shadow-[0_1px_8px_rgba(0,0,0,0.7)]">
                Gratis para empezar{" "}
                <span className="text-ln-faint">· Web · Lightning</span>
              </span>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mx-auto max-w-[1240px] px-[22px] py-8">
        {/* Buscador full-width (solo móvil, al tope del catálogo) */}
        <form action="/" method="get" className="mb-6 ln:hidden">
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar juegos…"
            aria-label="Buscar juegos"
            className="h-[46px] w-full rounded-full border border-ln-border bg-ln-bg-deep px-5 text-sm text-ln-text outline-none placeholder:text-ln-faint focus:ring-2 focus:ring-ln-luna/20"
          />
        </form>

        {!showHero ? (
          <section className="mb-8">
            <h1 className="font-display text-[40px] font-extrabold tracking-tight text-white">
              Tienda
            </h1>
            <p className="mt-2 max-w-xl text-ln-muted">
              Todo se juega en el navegador. Pagá con Lightning, conectá con
              Nostr.
            </p>
          </section>
        ) : null}

        {/* Riel social "amigos jugando" (cliente) */}
        <SocialRail />

      {/* Chips de categoría (destino del CTA "Explorar la tienda") */}
      <nav id="catalogo" className="mb-7 flex flex-wrap gap-2 scroll-mt-[80px]">
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

      <section>
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
                  }}
                />
              ))}
            </div>

            {totalPages > 1 ? (
              <div className="mt-10 flex items-center justify-center gap-4 text-sm">
                {page > 1 ? (
                  <Link
                    href={linkFor(page - 1)}
                    className="rounded-full border border-ln-border px-4 py-2 text-ln-text transition-colors hover:bg-white/5"
                  >
                    ← Anterior
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
                    Siguiente →
                  </Link>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>
      </div>
    </>
  );
}
