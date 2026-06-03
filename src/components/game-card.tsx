import Link from "next/link";
import { priceLabel } from "@/lib/format";

export type GameCardData = {
  slug: string;
  title: string;
  coverUrl: string | null;
  priceSats: number;
};

export function GameCard({ game }: { game: GameCardData }) {
  return (
    <Link href={`/game/${game.slug}`} className="group block">
      <div className="aspect-[3/4] overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-sky-900/40 to-zinc-900 transition-colors group-hover:border-sky-500/40">
        {game.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.coverUrl}
            alt={game.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-sm font-semibold text-zinc-300">
            {game.title}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-sm text-zinc-200">{game.title}</span>
        <span className="shrink-0 text-xs font-medium text-sky-400">
          {priceLabel(game.priceSats)}
        </span>
      </div>
    </Link>
  );
}
