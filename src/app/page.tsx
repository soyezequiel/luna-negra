import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GameCard } from "@/components/game-card";
import { CATEGORIES, normalizeCategory } from "@/lib/categories";
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
    <div className="mx-auto max-w-6xl px-4 py-10">
      <section className="rounded-xl border border-white/10 bg-gradient-to-b from-sky-500/10 to-transparent p-8">
        <h1 className="text-3xl font-bold">Tienda</h1>
        <p className="mt-2 max-w-xl text-zinc-400">
          Juegos web con pagos en Bitcoin (Lightning). Sin instalar nada: jugás
          directo desde el navegador.
        </p>
      </section>

      <form action="/" method="get" className="mt-6 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar juegos…"
          className="w-full max-w-sm rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-500/50"
        />
        <button className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400">
          Buscar
        </button>
      </form>

      <nav className="mt-5 flex flex-wrap gap-2">
        {[{ slug: "", label: "Todas" }, ...CATEGORIES].map((c) => {
          const active = (c.slug || null) === cat;
          return (
            <Link
              key={c.slug || "all"}
              href={catLink(c.slug)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                active
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-300"
                  : "border-white/15 text-zinc-400 hover:bg-white/5",
              )}
            >
              {c.label}
            </Link>
          );
        })}
      </nav>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">
          {q ? `Resultados para "${q}"` : "Destacados"}
        </h2>
        {games.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {q
              ? "No hay juegos que coincidan con tu búsqueda."
              : "Todavía no hay juegos publicados."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {games.map((g) => (
                <GameCard
                  key={g.id}
                  game={{
                    slug: g.slug,
                    title: g.title,
                    coverUrl: g.coverUrl,
                    priceSats: g.priceSats,
                  }}
                />
              ))}
            </div>

            {totalPages > 1 ? (
              <div className="mt-8 flex items-center justify-center gap-4 text-sm">
                {page > 1 ? (
                  <Link
                    href={linkFor(page - 1)}
                    className="rounded-md border border-white/15 px-3 py-1.5 hover:bg-white/5"
                  >
                    ← Anterior
                  </Link>
                ) : null}
                <span className="text-zinc-500">
                  Página {page} de {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={linkFor(page + 1)}
                    className="rounded-md border border-white/15 px-3 py-1.5 hover:bg-white/5"
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
