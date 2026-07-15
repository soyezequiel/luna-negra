"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { priceLabel, hueFromSlug } from "@/lib/format";
import { categoryLabel } from "@/lib/categories";
import { normalizeImageUrl } from "@/lib/game-media";
import { reviewLabelClass } from "@/lib/reviews";

export type GameCardData = {
  slug: string;
  title: string;
  coverUrl: string | null;
  // Portada horizontal (16:9) y capturas: alimentan el popup de hover (las
  // capturas van primero; si no hay, la portada horizontal). La card en sí
  // sigue mostrando la portada vertical (coverUrl).
  horizontalCoverUrl?: string | null;
  screenshots?: string[];
  priceSats: number;
  categories?: string[];
  multiplayer?: boolean;
  // Capacidades de Nostr Games Protocol (NGP) ACTIVAS del juego (0–ngpTotal). >0
  // muestra el sello "NGP N/M"; el color se gradúa según qué tan integrado esté.
  ngpActive?: number;
  ngpTotal?: number;
  // NGE detectado: el juego puede crear apuestas de satoshis vía escrow.
  ngeIntegrated?: boolean;
  // Resumen de reseñas ("Muy positivas"); null/undefined = sin reseñas, no se muestra.
  reviewLabel?: string | null;
};

// Fracción de capacidades NGP activas (0–1): tenue → aurora → brillante. Es la
// única fuente de los umbrales de color, compartida por el sello y por el panel
// del carrusel destacado (vía ngpRatioTextClass).
function ngpRatio(active: number, total: number): number {
  return total > 0 ? active / total : 0;
}

// Chip del sello NGP (fondo + texto).
function ngpBadgeClass(active: number, total: number): string {
  const ratio = ngpRatio(active, total);
  if (ratio >= 0.8) return "bg-ln-aurora/25 text-ln-aurora-bright";
  if (ratio >= 0.4) return "bg-ln-aurora/20 text-ln-aurora";
  return "bg-ln-luna/20 text-ln-luna";
}

// Solo el color de texto del estado NGP (mismos umbrales que el sello), para el
// panel del carrusel destacado que muestra "✦ Integrado · NGP N/M …".
export function ngpRatioTextClass(active: number, total: number): string {
  const ratio = ngpRatio(active, total);
  if (ratio >= 0.8) return "text-ln-aurora-bright";
  if (ratio >= 0.4) return "text-ln-aurora";
  return "text-ln-luna";
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

// Sello de apuestas NGE. La animación vive en globals.css para poder respetar
// reduce-motion y la degradación sin GPU de toda la app.
export function NgeBadge({ enabled = false }: { enabled?: boolean }) {
  if (!enabled) return null;
  return (
    <span
      className="nge-badge"
      title="Este juego permite apostar satoshis con escrow NGE"
      aria-label="Apuestas de satoshis disponibles con NGE"
    >
      <span className="nge-badge__coin" aria-hidden>
        <span>ϟ</span>
      </span>
      <span className="nge-badge__copy">
        <strong>APOSTÁ SATS</strong>
        <small>NGE ESCROW</small>
      </span>
    </span>
  );
}

// ── Popup de detalle (hover) ─────────────────────────────────────────────────
// Se posiciona FIXED respecto al viewport (calculado del rect de la card), no
// absolute dentro de la grilla: así nunca lo tapa la sidebar de amigos. Es
// informativo (pointer-events:none); el click va sobre la card.
const POPUP_W = 300;
const POPUP_H = 300;
const POPUP_GAP = 12;

function computePopupPos(rect: DOMRect): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // La sidebar de amigos ocupa 308px a la derecha desde el breakpoint ln (880px).
  const sidebar = vw >= 880 ? 308 : 0;
  const rightRoom = vw - sidebar - 8;
  let left = rect.right + POPUP_GAP;
  if (left + POPUP_W > rightRoom) left = rect.left - POPUP_GAP - POPUP_W; // flip a la izquierda
  if (left < 8) left = Math.max(8, Math.min(rect.left, rightRoom - POPUP_W)); // último recurso
  const top = Math.max(8, Math.min(rect.top, vh - POPUP_H - 8));
  return { left, top };
}

function GameCardPopup({
  game,
  multiplayer,
  pos,
}: {
  game: GameCardData;
  multiplayer: boolean;
  pos: { left: number; top: number };
}) {
  const hue = hueFromSlug(game.slug);
  // Media del popup: capturas primero; si no hay, la portada horizontal; y como
  // último recurso la vertical (para no quedar en degradado si el juego tiene arte).
  const media =
    game.screenshots?.[0] ?? game.horizontalCoverUrl ?? game.coverUrl ?? null;
  const tags = [
    ...(game.categories ?? []).map((c) => categoryLabel(c)),
    "Juego web",
  ];
  return createPortal(
    <div
      className="ln-pop-in pointer-events-none fixed overflow-hidden rounded-[13px] border border-ln-border bg-[rgba(11,20,34,0.96)] shadow-ln-modal"
      style={{ left: pos.left, top: pos.top, width: POPUP_W, zIndex: 120 }}
      aria-hidden
    >
      {/* Media 16:9 con ken-burns sutil. */}
      <div
        className="cover relative aspect-video overflow-hidden"
        style={{ "--h": hue } as CSSProperties}
      >
        {media ? (
          <div
            className="ln-kenburns absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${normalizeImageUrl(media)})` }}
          />
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
        {multiplayer ? (
          <span className="absolute right-2 top-2 rounded-full bg-ln-aurora/20 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ln-aurora-bright backdrop-blur-sm">
            ⚇ Multi
          </span>
        ) : null}
        <div className="absolute bottom-2 left-2">
          <NgeBadge enabled={game.ngeIntegrated} />
        </div>
      </div>

      <div className="p-3.5">
        <h3 className="font-display text-[17px] font-extrabold leading-tight text-white">
          {game.title}
        </h3>
        <p
          className={`mt-1 text-[12px] font-medium ${
            game.reviewLabel ? reviewLabelClass(game.reviewLabel) : "text-ln-faint"
          }`}
        >
          {game.reviewLabel ?? "Sin reseñas todavía"}
        </p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-ln-border bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ln-muted"
            >
              {t}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-ln-border pt-2.5">
          <NgpBadge active={game.ngpActive} total={game.ngpTotal} />
          <span className="font-mono text-[11px] text-ln-luna-bright">
            Jugar en el navegador →
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function GameCard({ game, index = 0 }: { game: GameCardData; index?: number }) {
  const hue = hueFromSlug(game.slug);
  const free = game.priceSats === 0;
  const multiplayer =
    game.multiplayer ?? (game.categories?.includes("multijugador") ?? false);

  const coverRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onEnter = () => {
    if (timer.current) clearTimeout(timer.current);
    // El rect se mide al disparar el timer (300ms) para tomar ya asentada la
    // elevación del hover, no al entrar.
    timer.current = setTimeout(() => {
      const el = coverRef.current;
      if (el) setPos(computePopupPos(el.getBoundingClientRect()));
    }, 300);
  };
  const onLeave = () => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };

  return (
    <Link
      href={`/game/${game.slug}`}
      className="ln-fade-up group block"
      style={{ "--i": index } as CSSProperties}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div
        ref={coverRef}
        className="cover relative aspect-[3/4] overflow-hidden rounded-ln-lg border border-ln-border transition-[transform,box-shadow,border-color] duration-150 group-hover:-translate-y-[5px] group-hover:border-ln-luna/50 group-hover:shadow-ln-card"
        style={{ "--h": hue } as CSSProperties}
      >
        {/* Capa interna con zoom suave; el overflow-hidden vive en el contenedor. */}
        <div className="absolute inset-0 transition-transform duration-[350ms] ease-out group-hover:scale-105">
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
        </div>

        {/* Badges superiores: en la portada solo cabe la primera categoría. */}
        {game.categories && game.categories.length > 0 ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ln-soft backdrop-blur-sm">
            {categoryLabel(game.categories[0])}
          </span>
        ) : null}
        {/* Esquina superior derecha: Multi y/o sello NGP, apilados. */}
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          {multiplayer ? (
            <span className="rounded-full bg-ln-aurora/20 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ln-aurora-bright backdrop-blur-sm">
              ⚇ Multi
            </span>
          ) : null}
          <NgpBadge active={game.ngpActive} total={game.ngpTotal} />
        </div>
        <div className="absolute bottom-2 left-2 z-10">
          <NgeBadge enabled={game.ngeIntegrated} />
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

      {pos ? <GameCardPopup game={game} multiplayer={multiplayer} pos={pos} /> : null}
    </Link>
  );
}
