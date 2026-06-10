import Link from "next/link";
import type { CSSProperties } from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GameCard } from "@/components/game-card";
import { CATEGORIES, normalizeCategory, categoryLabel } from "@/lib/categories";
import { hueFromSlug } from "@/lib/format";
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
    ...(cat ? { category: cat } : {}),
  };

  const [games, total] = await Promise.all([
    prisma.game.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.game.count({ where }),
  ]);

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
    <div className="mx-auto max-w-6xl px-4 py-8">
      {hero ? (
        <section
          className="cover relative mb-8 overflow-hidden rounded-lg border border-line shadow-[0_18px_40px_-22px_rgba(0,0,0,.85)]"
          style={{ "--h": hueFromSlug(hero.slug) } as CSSProperties}
        >
          {hero.horizontalCoverUrl || hero.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hero.horizontalCoverUrl ?? hero.coverUrl ?? ""}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          <div
            className="relative flex min-h-[300px] flex-col justify-end gap-3 p-6 sm:min-h-[340px] sm:p-10"
            style={{
              background:
                "linear-gradient(90deg, rgba(13,20,30,.96), rgba(13,20,30,.55) 45%, transparent 72%)",
            }}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue">
              Destacado
            </p>
            <h1 className="max-w-xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {hero.title}
            </h1>
            {hero.description ? (
              <p className="max-w-lg text-sm text-ink/90 line-clamp-2">
                {hero.description}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-sm bg-white/10 px-2 py-1 text-faint">
                Sin instalar
              </span>
              {hero.category ? (
                <span className="rounded-sm bg-white/10 px-2 py-1 text-faint">
                  {categoryLabel(hero.category)}
                </span>
              ) : null}
              <span className="rounded-sm bg-white/10 px-2 py-1 text-faint">
                Web · Lightning
              </span>
            </div>
            <div className="mt-2">
              <Link href={`/game/${hero.slug}`} className="btn btn-blue btn-xl">
                Ver juego
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-white">Tienda</h1>
          <p className="mt-2 max-w-xl text-muted">
            Todo se juega en el navegador. Pagos en Bitcoin (Lightning).
          </p>
        </section>
      )}

      <form action="/" method="get" className="mb-5 flex gap-2 md:hidden">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar juegos…"
          className="w-full max-w-sm rounded-sm border border-line bg-black/30 px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue/30"
        />
        <button className="btn btn-blue">Buscar</button>
      </form>

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
        <h2 className="mb-4 text-[17px] font-semibold text-ink">
          {q
            ? `Resultados para "${q}"`
            : cat
              ? categoryLabel(cat)
              : "Catálogo"}
        </h2>
        {games.length === 0 ? (
          <p className="text-sm text-faint">
            {q
              ? "No hay juegos que coincidan con tu búsqueda."
              : "Todavía no hay juegos publicados."}
          </p>
        ) : (
          <>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              {gridGames.map((g) => (
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

            {totalPages > 1 ? (
              <div className="mt-8 flex items-center justify-center gap-4 text-sm">
                {page > 1 ? (
                  <Link
                    href={linkFor(page - 1)}
                    className="rounded-sm border border-line px-3 py-1.5 text-ink hover:bg-white/5"
                  >
                    ← Anterior
                  </Link>
                ) : null}
                <span className="text-faint">
                  Página {page} de {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={linkFor(page + 1)}
                    className="rounded-sm border border-line px-3 py-1.5 text-ink hover:bg-white/5"
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
