import Link from "next/link";
import type { CSSProperties } from "react";
import { priceLabel, hueFromSlug } from "@/lib/format";
import { categoryLabel } from "@/lib/categories";

export type GameCardData = {
  slug: string;
  title: string;
  coverUrl: string | null;
  priceSats: number;
  category?: string | null;
};

export function GameCard({ game }: { game: GameCardData }) {
  const hue = hueFromSlug(game.slug);
  const free = game.priceSats === 0;

  return (
    <Link href={`/game/${game.slug}`} className="group block">
      <div
        className="cover relative aspect-[3/4] overflow-hidden rounded border border-line transition-all duration-150 group-hover:-translate-y-[3px] group-hover:ring-1 group-hover:ring-blue/40 group-hover:shadow-[0_0_26px_-6px_var(--blue-glow)]"
        style={{ "--h": hue } as CSSProperties}
      >
        {game.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.coverUrl}
            alt={game.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-sm font-semibold text-white/90">
            {game.title}
          </div>
        )}
        {/* Overlay al hover con CTA azul "Ver juego" */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <span className="btn btn-blue px-4 py-2 text-[13px]">Ver juego</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[15px] text-ink">{game.title}</span>
        <span
          className={`shrink-0 font-mono text-xs font-semibold ${free ? "text-green" : "text-btc"}`}
        >
          {priceLabel(game.priceSats)}
        </span>
      </div>
      {game.category ? (
        <div className="mt-1 text-[11px] text-faint">
          {categoryLabel(game.category)}
        </div>
      ) : null}
    </Link>
  );
}
