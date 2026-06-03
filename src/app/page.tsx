import { prisma } from "@/lib/prisma";
import { GameCard } from "@/components/game-card";

export const dynamic = "force-dynamic";

export default async function StorePage() {
  const games = await prisma.game.findMany({
    where: { status: "published" },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <section className="rounded-xl border border-white/10 bg-gradient-to-b from-sky-500/10 to-transparent p-8">
        <h1 className="text-3xl font-bold">Tienda</h1>
        <p className="mt-2 max-w-xl text-zinc-400">
          Juegos web con pagos en Bitcoin (Lightning). Sin instalar nada: jugás
          directo desde el navegador.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">Destacados</h2>
        {games.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Todavía no hay juegos publicados. Corré{" "}
            <code className="rounded bg-white/10 px-1">npx prisma db seed</code>{" "}
            para cargar ejemplos.
          </p>
        ) : (
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
        )}
      </section>
    </div>
  );
}
