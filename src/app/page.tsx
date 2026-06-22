import Link from "next/link";
import type { CSSProperties } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GameCard } from "@/components/game-card";
import { SocialRail } from "@/components/social-rail";
import { CATEGORIES, normalizeCategory, categoryLabel } from "@/lib/categories";
import { hueFromSlug, priceLabel } from "@/lib/format";
import { normalizeImageUrl } from "@/lib/game-media";
import { scoreGamesByIntegration } from "@/lib/integration-telemetry";
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

  const where: Prisma.GameWhereInput = {
    status: "published",
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    ...(cat ? { categories: { has: cat } } : {}),
  };

  // Traemos todos los juegos que matchean (no solo la página) porque el orden por
  // integración no es una columna: se calcula combinando telemetría + dominio. El
  // catálogo del MVP es chico, así que rankear y paginar en memoria es aceptable.
  const allGames = await prisma.game.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  const total = allGames.length;

  // Prioridad: más interfaces de Luna Negra integradas → más arriba. Empate por
  // más reciente (el orderBy de arriba ya deja los nuevos primero, sort estable).
  const scores = await scoreGamesByIntegration(allGames);
  const ranked = [...allGames].sort(
    (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0),
  );
  const games = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Hero destacado: el juego más nuevo, solo en la portada limpia (sin búsqueda
  // ni filtro, página 1). Se quita de la grilla para no duplicarlo.
  const hero = !q && !cat && page === 1 && games.length > 0 ? games[0] : null;
  const gridGames = hero ? games.slice(1) : games;

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
    <div className="mx-auto max-w-[1240px] px-[22px] py-8">
      {/* Buscador full-width (solo móvil, al tope del Home) */}
      <form action="/" method="get" className="mb-6 ln:hidden">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar juegos…"
          aria-label="Buscar juegos"
          className="h-[46px] w-full rounded-full border border-ln-border bg-ln-bg-deep px-5 text-sm text-ln-text outline-none placeholder:text-ln-faint focus:ring-2 focus:ring-ln-luna/20"
        />
      </form>

      {hero ? (
        <section
          className="cover relative mb-9 animate-ln-rise overflow-hidden rounded-ln-xl border border-ln-border shadow-ln-card"
          style={{ "--h": hueFromSlug(hero.slug) } as CSSProperties}
        >
          {hero.horizontalCoverUrl || hero.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={normalizeImageUrl(hero.horizontalCoverUrl ?? hero.coverUrl ?? "")}
              alt=""
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}

          {/* Corona decorativa arriba-derecha */}
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] animate-ln-corona rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, transparent 52%, rgba(255,182,72,.22) 56%, rgba(157,140,255,.14) 62%, transparent 72%)",
            }}
            aria-hidden
          />

          <div
            className="relative flex min-h-[350px] flex-col justify-end gap-3 p-6 ln:min-h-[430px] ln:p-12"
            style={{
              background:
                "linear-gradient(95deg, rgba(8,7,12,.96) 8%, rgba(8,7,12,.7) 42%, transparent 78%)",
            }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="ln-label rounded-full bg-black/40 px-2.5 py-1 !text-ln-corona-bright">
                ★ Destacado
              </span>
              {hero.categories.length > 0 ? (
                <span className="flex items-center gap-1.5 text-[12px] text-ln-soft">
                  {hero.categories.map((c) => categoryLabel(c)).join(" · ")}
                </span>
              ) : null}
            </div>

            <h1 className="max-w-2xl font-display text-[38px] font-extrabold leading-[1.04] tracking-tight text-white ln:text-[62px]">
              {hero.title}
            </h1>

            {hero.description ? (
              <p className="max-w-[480px] text-sm leading-relaxed text-ln-soft line-clamp-2">
                {hero.description}
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-4">
              <Link
                href={`/game/${hero.slug}`}
                className="btn btn-luna btn-xl shadow-ln-luna"
              >
                ▶ Ver juego
              </Link>
              <span className="font-mono text-sm text-ln-corona-bright">
                {priceLabel(hero.priceSats)}{" "}
                <span className="text-ln-faint">· Web · Lightning</span>
              </span>
            </div>
          </div>
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

      {/* Riel social "amigos jugando" (cliente) */}
      <SocialRail />

      {/* Chips de categoría */}
      <nav className="mb-7 flex flex-wrap gap-2">
        {[{ slug: "", label: "Todas" }, ...CATEGORIES].map((c) => {
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
                    integration: scores.get(g.id) ?? 0,
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
  );
}
