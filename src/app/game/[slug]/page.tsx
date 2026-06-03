import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { BuyButton } from "@/components/buy-button";
import { ReviewsSection } from "@/components/reviews-section";
import { priceLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
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

  const screenshots: string[] = JSON.parse(game.screenshots || "[]");

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold">{game.title}</h1>
      <p className="mt-1 text-sm text-zinc-500">por {game.provider.name}</p>

      <div className="mt-6 flex flex-col gap-6 sm:flex-row">
        <div className="aspect-[3/4] w-full max-w-[220px] shrink-0 overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-sky-900/40 to-zinc-900">
          {game.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={game.coverUrl}
              alt={game.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center font-semibold text-zinc-300">
              {game.title}
            </div>
          )}
        </div>

        <div className="flex-1">
          <p className="whitespace-pre-wrap text-zinc-300">
            {game.description || "Sin descripción."}
          </p>
          <div className="mt-6 flex items-center gap-4">
            <span className="text-xl font-semibold text-sky-400">
              {priceLabel(game.priceSats)}
            </span>
            <BuyButton
              gameId={game.id}
              priceSats={game.priceSats}
              owned={owned}
              gameUrl={game.gameUrl}
            />
          </div>
        </div>
      </div>

      {screenshots.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Capturas</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {screenshots.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt=""
                className="rounded-lg border border-white/10"
              />
            ))}
          </div>
        </section>
      ) : null}

      <ReviewsSection gameId={game.id} owned={owned} />
    </div>
  );
}
