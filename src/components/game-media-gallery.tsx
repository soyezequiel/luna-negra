"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameGalleryMedia } from "@/lib/game-media";

type GameMediaGalleryProps = {
  title: string;
  hue: number;
  media: GameGalleryMedia[];
};

export function GameMediaGallery({ title, hue, media }: GameMediaGalleryProps) {
  const [index, setIndex] = useState(0);
  const active = media[index] ?? null;
  const hasMany = media.length > 1;

  const label = useMemo(() => {
    if (!active) return title;
    if (active.kind === "screenshot") return `${title} - captura ${index + 1}`;
    if (active.kind === "horizontalCover") return `${title} - portada horizontal`;
    return `${title} - portada vertical`;
  }, [active, index, title]);

  function move(delta: number) {
    if (media.length === 0) return;
    setIndex((current) => (current + delta + media.length) % media.length);
  }

  return (
    <div className="space-y-3">
      <div
        className="cover relative aspect-video overflow-hidden rounded-lg border border-line bg-black/20"
        style={{ "--h": hue } as CSSProperties}
      >
        {active ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={active.src}
            alt={label}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xl font-semibold text-white/90">
            {title}
          </div>
        )}

        {hasMany ? (
          <>
            <button
              type="button"
              aria-label="Captura anterior"
              onClick={() => move(-1)}
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/65 text-xl font-semibold text-white shadow-lg transition hover:bg-black/85 focus:outline-none focus:ring-2 focus:ring-blue/60"
            >
              {"<"}
            </button>
            <button
              type="button"
              aria-label="Captura siguiente"
              onClick={() => move(1)}
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/65 text-xl font-semibold text-white shadow-lg transition hover:bg-black/85 focus:outline-none focus:ring-2 focus:ring-blue/60"
            >
              {">"}
            </button>
            <div className="absolute bottom-3 right-3 rounded-sm bg-black/70 px-2 py-1 font-mono text-[11px] text-white/85">
              {index + 1} / {media.length}
            </div>
          </>
        ) : null}
      </div>

      {hasMany ? (
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {media.map((item, itemIndex) => (
            <button
              key={`${item.src}-${itemIndex}`}
              type="button"
              aria-label={`Ver captura ${itemIndex + 1}`}
              onClick={() => setIndex(itemIndex)}
              className={`relative aspect-video overflow-hidden rounded-sm border transition focus:outline-none focus:ring-2 focus:ring-blue/60 ${
                itemIndex === index
                  ? "border-blue ring-1 ring-blue/70"
                  : "border-line opacity-75 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.src}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
