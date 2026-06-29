"use client";

/**
 * Luna Negra — fondo animado (selva con animales + luciérnagas).
 * Componente client autónomo: dibuja todo en un <canvas> fijo detrás de la app.
 *
 * - El fondo es una de 4 ilustraciones de selva según el momento del día
 *   (amanecer / dia / atardecer / noche), elegido por la hora real con "auto".
 * - Sobre la escena caminan/vuelan 5 animales (tigre, oso, gorila, avestruz, colibrí)
 *   con respiración, balanceo, sombra y parallax con el mouse.
 * - De noche/atardecer aparecen luciérnagas; de día son casi imperceptibles.
 *
 * Uso (App Router): montalo UNA vez, alto en el árbol (en app/layout.tsx,
 * dentro de <body>, antes del contenido):
 *
 *   import LunaNegraBackground from "@/components/LunaNegraBackground";
 *   <body>
 *     <LunaNegraBackground />
 *     <div className="relative z-[1]">{children}</div>
 *   </body>
 *
 * El contenido debe ir en z-index >= 1. Las secciones que quieras "calmadas"
 * deben llevar un fondo oscuro semitransparente (rgba(8,7,12,.92)) para atenuar
 * la escena detrás de ellas.
 */

import { useEffect, useRef } from "react";

export type Tiempo = "auto" | "amanecer" | "dia" | "atardecer" | "noche";

export interface LunaNegraBackgroundProps {
  /** Ambiente. "auto" lo resuelve según la hora local del visitante. */
  tiempo?: Tiempo;
  /** Cantidad de luciérnagas (10–120). */
  densidad?: number;
  /** Multiplicador de velocidad del movimiento (0.3–2). */
  velocidad?: number;
  /** Parallax sutil con el mouse. */
  parallax?: boolean;
  /** Mostrar los animales en la escena. */
  animales?: boolean;
  /** Oscurecer los laterales para mejorar legibilidad cuando hay texto encima. */
  scrim?: boolean;
  /** Clase extra para el <canvas> (ya se fija a pantalla completa). */
  className?: string;
  /** z-index del canvas. Por defecto 0 (poné tu contenido en z-index >= 1). */
  zIndex?: number;
  /** Carpeta pública con los assets (animales + fondos). Default "/luna-assets/". */
  assetsBase?: string;
  /** Fondo alternativo para el modo "dia". */
  diaBackgroundSrc?: string;
  /** Dibuja la escena como una composicion por capas con parallax (en todos los
   * momentos del dia; las capas se tintan segun el ambiente para combinar con el fondo). */
  layeredDiaScene?: boolean;
  /** Movimiento autonomo de animales/luciernagas. Si es false, solo repinta por carga, resize o puntero. */
  animated?: boolean;
  /** Limite de frames cuando hay movimiento continuo. Default 30. */
  frameRate?: number;
  /** Pausa el canvas cuando sale del viewport o la pestana queda oculta. */
  pauseWhenOffscreen?: boolean;
}

const ANIMALS = ["tiger", "bear", "gorilla", "ostrich", "hummingbird"] as const;
const BACKGROUNDS = ["amanecer", "dia", "atardecer", "noche"] as const;
type Animal = (typeof ANIMALS)[number];
type BackgroundName = (typeof BACKGROUNDS)[number];
const LAYERED_FILES = {
  tiger: "tiger.webp",
  bear: "bear.webp",
  gorilla: "gorilla.webp",
  ostrich: "ostrich.webp",
  hummingbird: "hummingbird.webp",
  leftFoliage: "foreground-left-foliage-overlay.webp",
  rightFoliage: "foreground-right-foliage-overlay.webp",
  pondGrass: "pond-edge-grass-strip.webp",
  shadow: "soft-contact-shadow.webp",
} as const;

type LayeredAsset = keyof typeof LAYERED_FILES;
type LayeredCreature = {
  asset: Animal;
  cx: number;
  bottom: number;
  h: number;
  px: number;
  py: number;
  phase: number;
  float?: boolean;
  shadow?: { w: number; h: number; alpha: number };
};

// La escena por capas está dibujada sobre el fondo de 1280×960. Estas marcas
// definen el centro y el rango horizontal donde viven los animales (sin contar
// el follaje, que sí puede sangrar por los bordes) para el ajuste responsive.
const DESIGN_CENTER_X = 640;
const DESIGN_CONTENT_L = 40;
const DESIGN_CONTENT_R = 1240;

const LAYERED_CREATURES: readonly LayeredCreature[] = [
  { asset: "hummingbird", cx: 1065, bottom: 334, h: 78, px: 18, py: 8, phase: 1.4, float: true },
  { asset: "gorilla", cx: 775, bottom: 455, h: 160, px: 5, py: 2, phase: 2.8, shadow: { w: 112, h: 32, alpha: 0.14 } },
  { asset: "bear", cx: 505, bottom: 620, h: 245, px: 13, py: 5, phase: 0.6, shadow: { w: 190, h: 42, alpha: 0.2 } },
  { asset: "ostrich", cx: 990, bottom: 665, h: 255, px: 18, py: 7, phase: 2.1, shadow: { w: 116, h: 34, alpha: 0.18 } },
  { asset: "tiger", cx: 175, bottom: 722, h: 330, px: 26, py: 9, phase: 3.2, shadow: { w: 250, h: 50, alpha: 0.22 } },
];

/** Color y presencia de las luciérnagas por momento del día. */
function fireflyConfig(t: string): { rgb: [number, number, number]; alpha: number } {
  if (t === "dia") return { rgb: [255, 250, 230], alpha: 0.22 };
  if (t === "amanecer") return { rgb: [255, 224, 160], alpha: 0.7 };
  if (t === "atardecer") return { rgb: [255, 205, 122], alpha: 1 };
  return { rgb: [190, 233, 200], alpha: 1 }; // noche
}

// El ciclo sigue el sol REAL de Buenos Aires (la tienda vive acá). Calculamos
// amanecer/atardecer del día con la ecuación del Almanac for Computers (1990) y
// comparamos instantes absolutos (UTC), así se ve igual en cualquier huso.
const BA_LAT = -34.6131;
const BA_LNG = -58.3772;

/** Hora UTC (0–24) del orto/ocaso para el día N del año en (lat,lng). null en zona polar. */
function sunUTCHours(N: number, isSunrise: boolean, lat: number, lng: number): number | null {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const ZENITH = 90.833; // orto/ocaso oficial (incluye refracción + radio solar)
  const lngHour = lng / 15;
  const t = N + ((isSunrise ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;                                   // anomalía media
  let L = M + 1.916 * Math.sin(M * D2R) + 0.020 * Math.sin(2 * M * D2R) + 282.634;
  L = ((L % 360) + 360) % 360;                                    // longitud verdadera
  let RA = R2D * Math.atan(0.91764 * Math.tan(L * D2R));          // ascensión recta
  RA = ((RA % 360) + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;       // mismo cuadrante que L
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(L * D2R);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(ZENITH * D2R) - sinDec * Math.sin(lat * D2R)) / (cosDec * Math.cos(lat * D2R));
  if (cosH > 1 || cosH < -1) return null;                        // no sale / no se pone
  let H = isSunrise ? 360 - R2D * Math.acos(cosH) : R2D * Math.acos(cosH);
  H /= 15;
  const T = H + RA - 0.06571 * t - 6.622;
  return (((T - lngHour) % 24) + 24) % 24;
}

let sunCache: { key: string; sr: number | null; ss: number | null } | null = null;

function resolveTiempo(t: Tiempo): string {
  if (t && t !== "auto") return t;
  const now = new Date();
  const key = now.toISOString().slice(0, 10); // día UTC
  if (!sunCache || sunCache.key !== key) {
    const y = now.getUTCFullYear();
    const base = Date.UTC(y, now.getUTCMonth(), now.getUTCDate());
    const N = Math.floor((base - Date.UTC(y, 0, 0)) / 86400000); // día del año (1 = 1 ene)
    sunCache = { key, sr: sunUTCHours(N, true, BA_LAT, BA_LNG), ss: sunUTCHours(N, false, BA_LAT, BA_LNG) };
  }
  if (sunCache.sr == null || sunCache.ss == null) return "noche"; // por las dudas (no pasa en BA)
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const SR = base + sunCache.sr * 3600e3;
  const SS = base + sunCache.ss * 3600e3;
  const m = 60e3, tn = now.getTime();
  if (tn >= SR - 45 * m && tn < SR + 60 * m) return "amanecer";  // ~1¾ h alrededor del orto
  if (tn >= SR + 60 * m && tn < SS - 60 * m) return "dia";
  if (tn >= SS - 60 * m && tn < SS + 30 * m) return "atardecer"; // ~1½ h alrededor del ocaso
  return "noche";
}

function makeGlow(rgb: [number, number, number]): HTMLCanvasElement {
  const s = 64, cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const x = cv.getContext("2d")!;
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
  g.addColorStop(0.28, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`);
  g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  return cv;
}

export default function LunaNegraBackground({
  tiempo = "auto",
  densidad = 55,
  velocidad = 1,
  parallax = true,
  animales = true,
  scrim = true,
  className = "",
  zIndex = 0,
  assetsBase = "/luna-assets/",
  diaBackgroundSrc,
  layeredDiaScene = false,
  animated = true,
  frameRate = 30,
  pauseWhenOffscreen = true,
}: LunaNegraBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cfg = useRef({ tiempo, densidad, velocidad, parallax, animales, scrim, layeredDiaScene, animated, frameRate });

  useEffect(() => {
    cfg.current = { tiempo, densidad, velocidad, parallax, animales, scrim, layeredDiaScene, animated, frameRate };
  }, [tiempo, densidad, velocidad, parallax, animales, scrim, layeredDiaScene, animated, frameRate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, raf = 0, last = 0, lastFrame = 0;
    let running = false;
    const t0 = performance.now();
    const mouse = { x: 0, y: 0, nx: 0, ny: 0 };
    let paintStatic = () => {};
    const loadedImages: HTMLImageElement[] = [];
    const onImageLoad = () => paintStatic();

    // carga de imágenes
    const base = assetsBase.endsWith("/") ? assetsBase : assetsBase + "/";
    const loadImage = (src: string) => {
      const im = new Image();
      im.decoding = "async";
      im.addEventListener("load", onImageLoad);
      loadedImages.push(im);
      im.src = src;
      return im;
    };
    const imgs: Partial<Record<Animal, HTMLImageElement>> = {};
    const getAnimal = (name: Animal) => {
      imgs[name] ??= loadImage(`${base}${name}.png`);
      return imgs[name];
    };
    if (animales && !layeredDiaScene) {
      for (const n of ANIMALS) getAnimal(n);
    }
    const layeredImgs: Partial<Record<LayeredAsset, HTMLImageElement>> = {};
    if (layeredDiaScene) {
      const layeredBase = `${base}composite/`;
      for (const key of Object.keys(LAYERED_FILES) as LayeredAsset[]) {
        layeredImgs[key] = loadImage(`${layeredBase}${LAYERED_FILES[key]}`);
      }
    }
    const bgs: Partial<Record<BackgroundName, HTMLImageElement>> = {};
    const bgSrc = (name: BackgroundName) => (
      name === "dia" && diaBackgroundSrc && !layeredDiaScene ? diaBackgroundSrc : `${base}bg-${name}.jpg`
    );
    const getBg = (name: string) => {
      const key = (BACKGROUNDS as readonly string[]).includes(name) ? name as BackgroundName : "dia";
      bgs[key] ??= loadImage(bgSrc(key));
      return bgs[key];
    };

    let tiempoNow = resolveTiempo(cfg.current.tiempo);
    let fc = fireflyConfig(tiempoNow);
    let glowSprite = makeGlow(fc.rgb);
    let density = 0;

    type Creature = { type: Animal; fx: number; baseY: number; s: number; bobAmp: number; fly: boolean; bob: number; phase: number };
    let scene: {
      bokeh: { x: number; y: number; r: number; tw: number; sp: number; vx: number }[];
      fireflies: { x: number; y: number; amp: number; ph: number; r: number; vy: number; fl: number; fs: number }[];
      creatures: Creature[];
    };

    const r = () => Math.random() * 6.28;
    const buildFireflies = (n: number) => {
      scene.bokeh = n > 0
        ? Array.from({ length: 11 }, () => ({ x: Math.random() * W, y: H * (0.4 + Math.random() * 0.5), r: 16 + Math.random() * 30, tw: Math.random() * 6.28, sp: 0.3 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 5 }))
        : [];
      scene.fireflies = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: H * (0.45 + Math.random() * 0.55),
        amp: 8 + Math.random() * 24, ph: Math.random() * 6.28,
        r: 1.5 + Math.random() * 2.4, vy: 6 + Math.random() * 13,
        fl: Math.random() * 6.28, fs: 0.6 + Math.random() * 1.1,
      }));
      density = n;
    };

    const initScene = () => {
      scene = {
        bokeh: [],
        fireflies: [],
        creatures: [
          { type: "hummingbird", fx: 0.49, baseY: 0.40, s: 0.52, bobAmp: 11, fly: true, bob: r(), phase: r() },
          { type: "ostrich", fx: 0.71, baseY: 0.85, s: 1.02, bobAmp: 3, fly: false, bob: r(), phase: r() },
          { type: "tiger", fx: 0.14, baseY: 0.90, s: 1.00, bobAmp: 2.4, fly: false, bob: r(), phase: r() },
          { type: "gorilla", fx: 0.57, baseY: 0.92, s: 1.10, bobAmp: 2.4, fly: false, bob: r(), phase: r() },
          { type: "bear", fx: 0.38, baseY: 0.96, s: 1.18, bobAmp: 2.4, fly: false, bob: r(), phase: r() },
        ],
      };
      buildFireflies(Math.round(cfg.current.densidad));
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth || window.innerWidth;
      H = canvas.clientHeight || window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (scene) initScene();
    };

    const drawCreatures = (dt: number) => {
      const baseH = Math.max(150, Math.min(290, H * 0.25));
      const glowA = fc.alpha * 0.34;
      for (const cr of scene.creatures) {
        cr.bob += dt * 1.1;
        const img = getAnimal(cr.type);
        if (!img.complete || !img.naturalWidth) continue;
        const px = cr.fly ? 26 : 16;
        const cx = W * cr.fx + mouse.x * px;
        const groundY = H * cr.baseY + mouse.y * px * 0.45;
        const h = baseH * cr.s, w = h * (img.naturalWidth / img.naturalHeight);
        const bob = Math.sin(cr.bob) * cr.bobAmp;
        const drift = cr.fly ? Math.sin(cr.bob * 0.5 + cr.phase) * 9 : 0;
        const sway = Math.sin(cr.bob * 0.8 + cr.phase) * (cr.fly ? 0.05 : 0.02);
        const sq = 1 + Math.sin(cr.bob * 2 + cr.phase) * 0.012;
        if (!cr.fly) {
          ctx.save(); ctx.globalAlpha = 0.26; ctx.fillStyle = "#0a0608";
          ctx.beginPath(); ctx.ellipse(cx, groundY + 2, w * 0.40, 11 * cr.s, 0, 0, 6.3); ctx.fill(); ctx.restore();
        }
        if (glowA > 0.01) {
          ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = glowA;
          const gs = w * 1.5; ctx.drawImage(glowSprite, cx - gs / 2, (groundY - h * 0.5) - gs / 2, gs, gs);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
        }
        ctx.save();
        ctx.translate(cx + drift, groundY - bob);
        ctx.rotate(sway);
        ctx.scale(1, sq);
        ctx.drawImage(img, -w / 2, -h, w, h);
        ctx.restore();
      }
    };

    const drawFireflies = (t: number, dt: number) => {
      if (scene.bokeh.length === 0 && scene.fireflies.length === 0) return;
      const fa = fc.alpha;
      ctx.globalCompositeOperation = "lighter";
      for (const f of scene.bokeh) {
        f.tw += dt * f.sp; f.x += f.vx * dt;
        if (f.x < -70) f.x = W + 70; if (f.x > W + 70) f.x = -70;
        const b = (0.05 + 0.06 * (0.5 + 0.5 * Math.sin(f.tw))) * fa;
        const sz = f.r * 4; ctx.globalAlpha = b;
        ctx.drawImage(glowSprite, f.x - sz / 2, f.y - sz / 2, sz, sz);
      }
      for (const f of scene.fireflies) {
        f.y -= f.vy * dt; f.ph += dt;
        if (f.y < H * 0.30) { f.y = H * 1.04; f.x = Math.random() * W; }
        const sx = f.x + Math.sin(f.ph * 0.6 + f.fl) * f.amp * 0.4;
        const b = (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * f.fs * 2.2 + f.fl))) * fa;
        const sz = f.r * 9; ctx.globalAlpha = b;
        ctx.drawImage(glowSprite, sx - sz / 2, f.y - sz / 2, sz, sz);
        ctx.globalAlpha = Math.min(1, b + 0.2 * fa); ctx.fillStyle = "#fffceb";
        ctx.beginPath(); ctx.arc(sx, f.y, f.r * 0.6, 0, 6.3); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    };

    const imageReady = (img?: HTMLImageElement): img is HTMLImageElement => Boolean(img && img.complete && img.naturalWidth);

    const drawBackgroundImage = (bg: HTMLImageElement | undefined, offsetX: number, offsetY: number) => {
      if (!imageReady(bg)) {
        ctx.fillStyle = "#0c1622"; ctx.fillRect(0, 0, W, H);
        return null;
      }
      const iw = bg.naturalWidth, ih = bg.naturalHeight;
      const sc = Math.max(W / iw, H / ih);
      const dw = iw * sc, dh = ih * sc;
      const x = (W - dw) / 2 + offsetX;
      const y = (H - dh) / 2 - H * 0.04 + offsetY;
      ctx.drawImage(bg, x, y, dw, dh);
      return { x, y, sc };
    };

    const drawSceneRect = (
      img: HTMLImageElement | undefined,
      frame: { x: number; y: number; sc: number },
      x: number,
      y: number,
      w: number,
      h: number,
      px: number,
      py: number,
      alpha = 1,
      filter = "none",
    ) => {
      if (!imageReady(img)) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.filter = filter;
      ctx.drawImage(
        img,
        frame.x + x * frame.sc + mouse.x * px,
        frame.y + y * frame.sc + mouse.y * py,
        w * frame.sc,
        h * frame.sc,
      );
      ctx.restore();
    };

    // Tinte de iluminación por momento aplicado a las capas (animales/follaje).
    // Las capas están iluminadas "de día"; esto las acerca al ambiente del fondo.
    const sceneTint = (m: string): string => {
      if (m === "amanecer") return "brightness(1.02) saturate(1.06) sepia(0.12)";
      if (m === "atardecer") return "brightness(0.92) saturate(1.18) sepia(0.3) hue-rotate(-8deg)";
      if (m === "noche") return "brightness(0.42) saturate(0.85) contrast(1.05) hue-rotate(6deg)";
      return ""; // dia
    };
    const withTint = (tint: string, fx = ""): string =>
      [tint, fx].filter(Boolean).join(" ") || "none";

    const drawLayeredCreature = (
      layer: LayeredCreature,
      frame: { x: number; y: number; sc: number },
      t: number,
      tint = "",
    ) => {
      const img = layeredImgs[layer.asset];
      if (!imageReady(img)) return;

      const moving = cfg.current.animated && !reduce;
      // Respiración mínima: squash vertical anclado en las patas (no desplaza el
      // cuerpo, así que no "flota"). El movimiento de articulaciones se hace abajo
      // deformando el sprite por bandas.
      const breath = moving
        ? Math.sin(t * (layer.float ? 3.0 : 1.0) + layer.phase) * (layer.float ? 0.01 : 0.007)
        : 0;
      const h = layer.h * (1 + breath);
      const w = h * (img.naturalWidth / img.naturalHeight);

      // Responsive: la escena está diseñada en un lienzo de 1280px y se pinta en
      // "cover", así que en pantallas angostas (celular) los laterales quedan
      // recortados y los animales de los extremos se cortan. Comprimimos el
      // layout horizontal hacia el centro según el ancho visible y, como red de
      // seguridad, fijamos cada animal dentro del área visible. En desktop el
      // ancho visible es >= 1280 → squeeze = 1, no cambia nada.
      const visLeft = -frame.x / frame.sc;
      const visRight = (W - frame.x) / frame.sc;
      const margin = 10; // unidades de diseño
      const squeeze = Math.min(1, (visRight - visLeft - margin * 2) / (DESIGN_CONTENT_R - DESIGN_CONTENT_L));
      let cx = DESIGN_CENTER_X + (layer.cx - DESIGN_CENTER_X) * squeeze;
      const minCx = visLeft + w / 2 + margin;
      const maxCx = visRight - w / 2 - margin;
      cx = minCx <= maxCx ? Math.min(Math.max(cx, minCx), maxCx) : (visLeft + visRight) / 2;

      // Punto de apoyo (centro de las patas) en coordenadas de canvas: ancla del
      // squash de la respiración y del warp por bandas (offset 0 en el piso).
      const footX = frame.x + cx * frame.sc + mouse.x * layer.px;
      const footY = frame.y + layer.bottom * frame.sc + mouse.y * layer.py;
      const dw = w * frame.sc, dh = h * frame.sc;
      const left = footX - dw / 2;
      const top = footY - dh;

      if (layer.shadow) {
        drawSceneRect(
          layeredImgs.shadow,
          frame,
          cx - layer.shadow.w / 2,
          layer.bottom - layer.shadow.h * 0.55,
          layer.shadow.w,
          layer.shadow.h,
          layer.px,
          layer.py,
          layer.shadow.alpha,
        );
      }

      ctx.save();
      if (!moving) {
        // Estático: una sola pasada con sombra de contacto (+ tinte de ambiente).
        const ds = layer.float ? "drop-shadow(0 8px 8px rgba(3,9,16,.2))" : "drop-shadow(0 12px 12px rgba(3,9,16,.22))";
        ctx.filter = withTint(tint, ds);
        ctx.drawImage(img, left, top, dw, dh);
      } else {
        if (tint) ctx.filter = tint;
        // Articulación falsa: cortamos el sprite en bandas horizontales y
        // desplazamos cada una en X según su altura. Las patas (abajo) quedan
        // fijas y el torso/extremidades superiores flexionan con una onda que
        // viaja => parece que mueve las articulaciones, sin que el animal flote.
        const SLICES = 18;
        const natBand = img.naturalHeight / SLICES;
        const destBand = dh / SLICES;
        const amp = (layer.float ? 4 : 2.6) * frame.sc; // px máx de desplazamiento
        const spd = layer.float ? 2.4 : 1.0;            // el colibrí flamea más rápido
        for (let i = 0; i < SLICES; i++) {
          const v = 1 - (i + 0.5) / SLICES;             // 0 = patas, 1 = cabeza
          const ease = v * v * (3 - 2 * v);             // casi nulo cerca del suelo
          const flex =
            Math.sin(v * Math.PI * 1.3 - t * 1.3 * spd + layer.phase) * 0.7 +
            Math.sin(t * 0.8 * spd + layer.phase * 1.6) * v * 0.5;
          const off = flex * ease * amp;
          const sy = i * natBand;
          const sh = Math.min(natBand + 0.6, img.naturalHeight - sy); // solape anti-costura
          ctx.drawImage(img, 0, sy, img.naturalWidth, sh, left + off, top + i * destBand, dw, destBand + 0.6);
        }
      }
      ctx.restore();
    };

    const drawLayeredScene = (t: number, bg: HTMLImageElement | undefined) => {
      const frame = drawBackgroundImage(bg, mouse.x * -8, mouse.y * -5);
      if (!frame) return;

      const tint = sceneTint(tiempoNow);
      drawSceneRect(layeredImgs.pondGrass, frame, 238, 620, 470, 57, 11, 5, 0.48, withTint(tint));
      for (const layer of LAYERED_CREATURES) drawLayeredCreature(layer, frame, t, tint);
      drawSceneRect(layeredImgs.leftFoliage, frame, -110, 620, 520, 268, 34, 10, 0.98, withTint(tint, "drop-shadow(0 16px 14px rgba(3,9,16,.24))"));
      drawSceneRect(layeredImgs.rightFoliage, frame, 875, 585, 430, 233, 30, 9, 0.96, withTint(tint, "drop-shadow(0 14px 12px rgba(3,9,16,.2))"));
    };

    const draw = (t: number, dt: number, animalesOn: boolean, scrimOn: boolean, layeredOn: boolean) => {
      ctx.clearRect(0, 0, W, H);
      // fondo pintado del hero (cover-fit, leve parallax con el mouse)
      const bg = getBg(tiempoNow);
      if (layeredOn) {
        drawLayeredScene(t, bg);
      } else {
        drawBackgroundImage(bg, mouse.x * -14, mouse.y * -10);
        if (animalesOn) drawCreatures(dt);
      }
      drawFireflies(t, dt);
      if (scrimOn) {
        // scrim izquierdo para legibilidad del hero
        const ls = ctx.createLinearGradient(0, 0, W * 0.55, 0);
        ls.addColorStop(0, "rgba(6,6,12,0.55)"); ls.addColorStop(1, "rgba(6,6,12,0)");
        ctx.fillStyle = ls; ctx.fillRect(0, 0, W * 0.55, H);
        // funde el borde derecho hacia un color oscuro (evita corte duro contra paneles)
        const rs = ctx.createLinearGradient(W, 0, W - 110, 0);
        rs.addColorStop(0, "rgba(12,11,18,0.92)"); rs.addColorStop(1, "rgba(12,11,18,0)");
        ctx.fillStyle = rs; ctx.fillRect(W - 110, 0, 110, H);
      }
      // leve fundido inferior hacia el navy de la textura (el borde rasgado hace el resto)
      const bf = ctx.createLinearGradient(0, H * 0.80, 0, H);
      bf.addColorStop(0, "rgba(19,32,74,0)"); bf.addColorStop(1, "rgba(19,32,74,0.55)");
      ctx.fillStyle = bf; ctx.fillRect(0, H * 0.80, W, H * 0.20);
    };

    const paintFrame = (now: number, fixedDt?: number, immediateParallax = false) => {
      if (canvas.clientWidth > 0 && (canvas.clientWidth !== W || canvas.clientHeight !== H)) resize();
      const c = cfg.current;
      const tm = resolveTiempo(c.tiempo);
      if (tm !== tiempoNow) {
        tiempoNow = tm; fc = fireflyConfig(tm); glowSprite = makeGlow(fc.rgb);
      }
      getBg(tiempoNow);
      if (Math.round(c.densidad) !== density) buildFireflies(Math.round(c.densidad));
      const t = (now - t0) / 1000;
      let dt = fixedDt ?? (now - (last || now)) / 1000; last = now;
      dt = Math.min(0.05, dt) * c.velocidad;
      const targetX = c.parallax && !reduce ? mouse.nx : 0;
      const targetY = c.parallax && !reduce ? mouse.ny : 0;
      if (immediateParallax) {
        mouse.x = targetX;
        mouse.y = targetY;
      } else {
        mouse.x += (targetX - mouse.x) * 0.06;
        mouse.y += (targetY - mouse.y) * 0.06;
      }
      draw(t, dt, c.animales, c.scrim, c.layeredDiaScene);
    };

    paintStatic = () => paintFrame(performance.now(), 0, true);

    let inViewport = !pauseWhenOffscreen;
    let pageVisible = document.visibilityState !== "hidden";
    const shouldRun = () => cfg.current.animated && !reduce && pageVisible && inViewport;
    const stopLoop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      running = false;
    };
    const loop = (now: number) => {
      if (!shouldRun()) {
        stopLoop();
        return;
      }
      raf = requestAnimationFrame(loop);
      const fps = Math.max(1, cfg.current.frameRate || 30);
      const minFrameMs = 1000 / fps;
      if (lastFrame && now - lastFrame < minFrameMs) return;
      lastFrame = now;
      paintFrame(now);
    };
    const startLoop = () => {
      if (running || !shouldRun()) return;
      running = true;
      last = 0;
      lastFrame = 0;
      raf = requestAnimationFrame(loop);
    };
    const syncLoop = () => {
      if (shouldRun()) startLoop();
      else stopLoop();
    };

    const onResize = () => {
      resize();
      paintStatic();
      syncLoop();
    };
    const onMove = (e: PointerEvent) => {
      mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ny = (e.clientY / window.innerHeight) * 2 - 1;
      if (!running) paintStatic();
    };
    const onVisibility = () => {
      pageVisible = document.visibilityState !== "hidden";
      if (pageVisible) paintStatic();
      syncLoop();
    };
    let observer: IntersectionObserver | undefined;
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    initScene();
    getBg(tiempoNow);
    paintStatic();
    if (pauseWhenOffscreen && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(([entry]) => {
        inViewport = entry.isIntersecting;
        if (inViewport) paintStatic();
        syncLoop();
      }, { rootMargin: "160px 0px", threshold: 0 });
      observer.observe(canvas);
    } else {
      inViewport = true;
    }
    syncLoop();

    return () => {
      stopLoop();
      observer?.disconnect();
      paintStatic = () => {};
      for (const im of loadedImages) im.removeEventListener("load", onImageLoad);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [assetsBase, diaBackgroundSrc, layeredDiaScene, animated, animales, pauseWhenOffscreen]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex, display: "block", pointerEvents: "none", WebkitMaskImage: `url(${(assetsBase.endsWith("/") ? assetsBase : assetsBase + "/")}mask.png)`, maskImage: `url(${(assetsBase.endsWith("/") ? assetsBase : assetsBase + "/")}mask.png)`, WebkitMaskSize: "170% 105%", maskSize: "170% 105%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center bottom", maskPosition: "center bottom" }}
    />
  );
}
