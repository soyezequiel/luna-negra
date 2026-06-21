import Link from "next/link";
import type { CSSProperties } from "react";
import { priceLabel, hueFromSlug } from "@/lib/format";
import { categoryLabel } from "@/lib/categories";
import { normalizeImageUrl } from "@/lib/game-media";

export type GameCardData = {
  slug: string;
  title: string;
  coverUrl: string | null;
  priceSats: number;
  categories?: string[];
  multiplayer?: boolean;
};

export function GameCard({ game }: { game: GameCardData }) {
  const hue = hueFromSlug(game.slug);
  const free = game.priceSats === 0;

  return (
    <Link href={`/game/${game.slug}`} className="group block">
      <div
        className="cover relative aspect-[3/4] overflow-hidden rounded-ln-lg border border-ln-border transition-[transform,box-shadow,border-color] duration-150 group-hover:-translate-y-[5px] group-hover:border-ln-luna/50 group-hover:shadow-ln-card"
        style={{ "--h": hue } as CSSProperties}
      >
        {game.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={normalizeImageUrl(game.coverUrl)}
            alt={game.title}
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center font-display text-base font-bold text-white/90">
            {game.title}
          </div>
        )}

        {/* Badges superiores: en la portada solo cabe la primera categoría. */}
        {game.categories && game.categories.length > 0 ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ln-soft backdrop-blur-sm">
            {categoryLabel(game.categories[0])}
          </span>
        ) : null}
        {game.multiplayer ? (
          <span className="absolute right-2 top-2 rounded-full bg-ln-aurora/20 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ln-aurora-bright backdrop-blur-sm">
            ⚇ Multi
          </span>
        ) : null}

        {/* Degradado inferior para legibilidad */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="truncate text-[15px] text-ln-text transition-colors group-hover:text-white">
          {game.title}
        </span>
        <span
          className={`shrink-0 font-mono text-xs font-semibold ${
            free ? "text-ln-aurora-bright" : "text-ln-corona-bright"
          }`}
        >
          {priceLabel(game.priceSats)}
        </span>
      </div>
    </Link>
  );
}
