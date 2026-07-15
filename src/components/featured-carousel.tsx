"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { priceLabel, hueFromSlug } from "@/lib/format";
import { categoryLabel } from "@/lib/categories";
import { normalizeImageUrl } from "@/lib/game-media";
import { BalBadge, NgeBadge, ngpRatioTextClass } from "@/components/game-card";
import { cn } from "@/lib/utils";

// Subconjunto serializable de CatalogGame que necesita el carrusel destacado.
export type FeaturedGame = {
  slug: string;
  title: string;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
  screenshots: string[];
  videos: string[];
  priceSats: number;
  categories: string[];
  ngpActive: number;
  ngpTotal: number;
  ngeIntegrated: boolean;
  balCompatible: boolean;
};

// Fondo tipo "cover" centrado para una URL de imagen (o vacío si no hay).
function bgCover(url: string | null | undefined): CSSProperties {
  if (!url) return {};
  return {
    backgroundImage: `url(${normalizeImageUrl(url)})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

// Umbrales por ancho REAL del contenedor (medido con ResizeObserver): la sidebar
// de amigos (308px en ln:) reduce el ancho útil y window.innerWidth engaña.
const W_ROW = 720; // ≥ fila banner+panel (si no, columna apilada)
const W_PEEKS = 1000; // ≥ además tarjetas peek laterales

export function FeaturedCarousel({ games }: { games: FeaturedGame[] }) {
  const n = games.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  // Captura activa en el banner: null = portada horizontal (por defecto);
  // número = screenshots[shot] (al pasar el mouse / clickear una miniatura).
  const [shot, setShot] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  // Trailer en hover del banner: se reproduce mute y sin controles si el juego
  // tiene video.
  const [hoverBanner, setHoverBanner] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Ancho del contenedor.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Respeto por reduce-motion.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Auto-avance cada 6s (pausado en hover / con reduce-motion / con un solo juego).
  useEffect(() => {
    if (paused || reduced || n <= 1) return;
    const id = setInterval(() => {
      setShot(null);
      setIndex((i) => (i + 1) % n);
    }, 6000);
    return () => clearInterval(id);
  }, [paused, reduced, n]);

  // Precargar covers horizontales para que el cambio de slide no parpadee.
  useEffect(() => {
    for (const g of games) {
      const src = g.horizontalCoverUrl ?? g.coverUrl;
      if (src) {
        const img = new Image();
        img.src = normalizeImageUrl(src);
      }
    }
  }, [games]);

  // Reproduce/pausa el trailer según el hover del banner. Si el juego no tiene
  // video, el <video> no se monta y el ref queda null (no-op).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (hoverBanner && !reduced) {
      v.muted = true;
      v.currentTime = 0;
      v.play().catch(() => {
        /* autoplay bloqueado: ignorar */
      });
    } else {
      v.pause();
    }
  }, [hoverBanner, reduced, index]);

  if (n === 0) return null;

  const stacked = width > 0 && width < W_ROW;
  const showArrows = width >= W_ROW && n > 1;
  const showPeeks = width >= W_PEEKS && n > 1;

  const go = (i: number) => {
    setIndex(((i % n) + n) % n);
    setShot(null);
  };
  const prev = (e?: ReactMouseEvent) => {
    e?.preventDefault();
    go(index - 1);
  };
  const next = (e?: ReactMouseEvent) => {
    e?.preventDefault();
    go(index + 1);
  };

  const game = games[index];
  const free = game.priceSats === 0;
  const cat = game.categories[0];
  const prevGame = games[(index - 1 + n) % n];
  const nextGame = games[(index + 1) % n];

  const shots = game.screenshots ?? [];
  const hasShots = shots.length > 0;
  // Banner: portada horizontal por defecto; la captura activa si el usuario la
  // eligió. Fallbacks: horizontal → vertical → degradado por hue.
  const bannerBase = game.horizontalCoverUrl ?? game.coverUrl;
  const bannerImg =
    shot !== null && shots[shot] ? shots[shot] : bannerBase;
  // Trailer del juego (el primero). Se reproduce en hover del banner.
  const videoSrc = game.videos?.[0] ?? null;
  const showVideo = hoverBanner && !reduced && !!videoSrc;

  return (
    <div
      ref={containerRef}
      className="relative"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      {/* Tarjetas peek (juego anterior / siguiente) en los gutters laterales. */}
      {showPeeks ? (
        <>
          <PeekCard game={prevGame} side="left" onClick={prev} label="Juego anterior" />
          <PeekCard game={nextGame} side="right" onClick={next} label="Juego siguiente" />
        </>
      ) : null}

      <div
        className={cn("flex gap-3.5", stacked && "flex-col")}
        style={{
          height: stacked ? undefined : 430,
          margin: showPeeks ? "0 54px" : undefined,
        }}
      >
        {/* ── Banner ── */}
        <div
          className={cn("relative min-w-0", stacked ? "aspect-video w-full" : "flex-1")}
          onPointerEnter={() => setHoverBanner(true)}
          onPointerLeave={() => setHoverBanner(false)}
        >
          <Link
            href={`/game/${game.slug}`}
            aria-label={`Ver ${game.title}`}
            className="cover absolute inset-0 block overflow-hidden rounded-[10px] active:scale-[0.995]"
            style={{ "--h": hueFromSlug(game.slug), ...bgCover(bannerImg) } as CSSProperties}
          >
            {/* Trailer en hover: mute, en loop, sin controles. pointer-events
                desactivados para que el click/hover pase al Link. */}
            {videoSrc ? (
              <video
                ref={videoRef}
                src={normalizeImageUrl(videoSrc)}
                muted
                loop
                playsInline
                preload="metadata"
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 h-full w-full bg-black object-cover transition-opacity duration-200",
                  showVideo ? "opacity-100" : "opacity-0",
                )}
              />
            ) : null}
            {/* Scrim inferior para legibilidad del overlay. */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(0deg, rgba(5,4,9,.55), transparent 42%)",
              }}
              aria-hidden
            />
            <div className="absolute right-3 top-3 z-[2] flex items-center gap-1.5">
              <BalBadge enabled={game.balCompatible} />
              <NgeBadge enabled={game.ngeIntegrated} />
            </div>
            {/* Overlay abajo-izquierda: botón de acción + categoría. */}
            <div className="absolute bottom-[18px] left-5 flex flex-col items-start gap-3">
              <span
                className="rounded-[6px] px-4 py-2 text-[13px] font-extrabold"
                style={{
                  color: "#1a1430",
                  background: free
                    ? "linear-gradient(180deg,#ffd97a,#f2b21e)"
                    : "linear-gradient(120deg,#c2b5ff,#9d8cff)",
                  boxShadow: "0 8px 22px -8px rgba(0,0,0,.6)",
                }}
              >
                {free ? "▶ Jugar gratis" : `▶ Comprar · ${priceLabel(game.priceSats)}`}
              </span>
              {cat ? (
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/85">
                  {categoryLabel(cat)}
                </span>
              ) : null}
            </div>
          </Link>

          {/* Flechas (fuera del <a> para no navegar al usarlas). */}
          {showArrows ? (
            <>
              <BannerArrow side="left" onClick={prev} label="Anterior" />
              <BannerArrow side="right" onClick={next} label="Siguiente" />
            </>
          ) : null}
        </div>

        {/* ── Panel ── */}
        <div
          className={cn(
            "flex flex-col rounded-[10px] border border-ln-border px-[18px] py-4",
            !stacked && "w-[340px] shrink-0",
          )}
          style={{ background: "rgba(11,20,34,.9)" }}
        >
          <h2 className="font-display text-[21px] font-extrabold text-white">
            {game.title}
          </h2>
          {game.ngpActive > 0 ? (
            <p
              className={cn(
                "mt-1 text-[13px] font-semibold",
                ngpRatioTextClass(game.ngpActive, game.ngpTotal),
              )}
            >
              ✦ Integrado · NGP {game.ngpActive}/{game.ngpTotal} capacidades activas
            </p>
          ) : null}

          {/* Grilla 2×2 de capturas (solo si el juego tiene). Al pasar el mouse
              por una miniatura se muestra en el banner; al salir de la grilla,
              el banner vuelve a la imagen original (shot = null). */}
          {hasShots ? (
            <div
              className="mt-3.5 grid grid-cols-2 gap-2"
              onPointerLeave={() => setShot(null)}
            >
              {shots.slice(0, 4).map((src, i) => {
                const active = i === shot;
                return (
                  <button
                    key={i}
                    type="button"
                    onPointerEnter={() => setShot(i)}
                    onClick={() => setShot(i)}
                    aria-label={`Captura ${i + 1}`}
                    className="cover aspect-video overflow-hidden rounded-[6px] transition-transform"
                    style={
                      {
                        "--h": hueFromSlug(game.slug),
                        ...bgCover(src),
                        transform: active ? "scale(1.02)" : undefined,
                        border: active
                          ? "1px solid rgba(157,140,255,.85)"
                          : "1px solid rgba(255,255,255,.08)",
                        boxShadow: active
                          ? "0 0 0 1px rgba(157,140,255,.5), 0 6px 18px -8px rgba(157,140,255,.6)"
                          : undefined,
                      } as CSSProperties
                    }
                  />
                );
              })}
            </div>
          ) : null}

          {/* Destacado. */}
          <div className="mt-4">
            <p className="text-[13px] font-bold text-ln-aurora-bright">
              📈 Jugá al instante
            </p>
            <p className="mt-1 text-[12.5px] text-ln-soft">
              Corre 100% en el navegador — pagás con Lightning, sin descargas.
            </p>
          </div>

          {/* Pie: categoría (izq) + etiqueta de precio (der). */}
          <div className="mt-auto flex items-center justify-between gap-2 pt-3">
            <span className="font-mono text-[11px] text-ln-muted">
              {cat ? categoryLabel(cat) : "Juego web"}
            </span>
            <span
              className={cn(
                "rounded-[5px] border border-ln-border px-3.5 py-[7px] font-mono text-[13px]",
                free ? "text-ln-aurora-bright" : "text-ln-corona-bright",
              )}
              style={{ background: "#050409" }}
            >
              {free ? "Gratis" : priceLabel(game.priceSats)}
            </span>
          </div>
        </div>
      </div>

      {/* Puntos de navegación. */}
      {n > 1 ? (
        <div className="mt-3.5 flex items-center justify-center gap-2">
          {games.map((g, i) => {
            const active = i === index;
            return (
              <button
                key={g.slug}
                type="button"
                onClick={() => go(i)}
                aria-label={`Ir al destacado ${i + 1}`}
                aria-current={active}
                className="h-2 rounded-full transition-[width,background] duration-200"
                style={{
                  width: active ? 26 : 8,
                  background: active
                    ? "linear-gradient(120deg,#c2b5ff,#9d8cff)"
                    : "rgba(255,255,255,.22)",
                }}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function BannerArrow({
  side,
  onClick,
  label,
}: {
  side: "left" | "right";
  onClick: (e: ReactMouseEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 flex h-[58px] w-9 -translate-y-1/2 items-center justify-center rounded-lg text-white/85 backdrop-blur-[2px] transition-colors hover:text-white",
        side === "left" ? "left-2.5" : "right-2.5",
      )}
      style={{ background: "rgba(0,0,0,.4)", fontFamily: "Georgia, serif", fontSize: 36 }}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}

function PeekCard({
  game,
  side,
  onClick,
  label,
}: {
  game: FeaturedGame;
  side: "left" | "right";
  onClick: (e: ReactMouseEvent) => void;
  label: string;
}) {
  // La tira peek es vertical (46×430): la portada vertical encaja mejor que la
  // horizontal, así que priorizamos coverUrl.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "cover absolute top-0 z-[1] h-[430px] w-[46px] overflow-hidden rounded-[8px]",
        side === "left" ? "left-0" : "right-0",
      )}
      style={
        {
          "--h": hueFromSlug(game.slug),
          ...bgCover(game.coverUrl ?? game.horizontalCoverUrl),
          filter: "grayscale(1) brightness(.45)",
          opacity: 0.72,
        } as CSSProperties
      }
    />
  );
}
