import Link from "next/link";
import type { CSSProperties } from "react";
import { priceLabel, hueFromSlug } from "@/lib/format";
import { categoryLabel } from "@/lib/categories";
import { normalizeImageUrl } from "@/lib/game-media";
import { reviewLabelClass } from "@/lib/reviews";

export type GameCardData = {
  slug: string;
  title: string;
  coverUrl: string | null;
  priceSats: number;
  categories?: string[];
  multiplayer?: boolean;
  // Capacidades de Nostr Games Protocol (NGP) ACTIVAS del juego (0–ngpTotal). >0
  // muestra el sello "NGP N/M"; el color se gradúa según qué tan integrado esté.
  ngpActive?: number;
  ngpTotal?: number;
  // Resumen de reseñas ("Muy positivas"); null/undefined = sin reseñas, no se muestra.
  reviewLabel?: string | null;
};

// Color del sello NGP según qué tan integrado esté (fracción de capacidades
// activas): tenue → aurora → brillante. Mismo lenguaje que el panel (ln-aurora).
function ngpBadgeClass(active: number, total: number): string {
  const ratio = total > 0 ? active / total : 0;
  if (ratio >= 0.8) return "bg-ln-aurora/25 text-ln-aurora-bright";
  if (ratio >= 0.4) return "bg-ln-aurora/20 text-ln-aurora";
  return "bg-ln-luna/20 text-ln-luna";
}

// Sello "✦ NGP N/M": capacidades NGP activas del juego. Sin sello si 0. Compartido
// por la card del catálogo y las portadas del hero, para que estilo/color/tooltip
// sean una sola fuente. No posiciona: quien lo use lo ubica (absolute, flex, …).
export function NgpBadge({ active, total }: { active?: number; total?: number }) {
  if (!active || active <= 0) return null;
  const t = total && total > 0 ? total : active;
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] backdrop-blur-sm ${ngpBadgeClass(
        active,
        t,
      )}`}
      title={`Integrado con Nostr Games Protocol · ${active}/${t} capacidades NGP activas`}
    >
      ✦ NGP {active}/{t}
    </span>
  );
}

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
        {/* Esquina superior derecha: Multi y/o sello NGP, apilados. */}
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          {game.multiplayer ? (
            <span className="rounded-full bg-ln-aurora/20 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ln-aurora-bright backdrop-blur-sm">
              ⚇ Multi
            </span>
          ) : null}
          <NgpBadge active={game.ngpActive} total={game.ngpTotal} />
        </div>

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
      {game.reviewLabel ? (
        <p className={`mt-0.5 text-[11px] font-medium ${reviewLabelClass(game.reviewLabel)}`}>
          {game.reviewLabel}
        </p>
      ) : null}
    </Link>
  );
}
