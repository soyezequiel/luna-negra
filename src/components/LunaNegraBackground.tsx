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
}

const ANIMALS = ["tiger", "bear", "gorilla", "ostrich", "hummingbird"] as const;
const BACKGROUNDS = ["amanecer", "dia", "atardecer", "noche"] as const;

/** Color y presencia de las luciérnagas por momento del día. */
function fireflyConfig(t: string): { rgb: [number, number, number]; alpha: number } {
  if (t === "dia") return { rgb: [255, 250, 230], alpha: 0.22 };
  if (t === "amanecer") return { rgb: [255, 224, 160], alpha: 0.7 };
  if (t === "atardecer") return { rgb: [255, 205, 122], alpha: 1 };
  return { rgb: [190, 233, 200], alpha: 1 }; // noche
}

function resolveTiempo(t: Tiempo): string {
  if (t && t !== "auto") return t;
  const h = new Date().getHours();
  if (h >= 5 && h < 9) return "amanecer";
  if (h >= 9 && h < 17) return "dia";
  if (h >= 17 && h < 20) return "atardecer";
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
}: LunaNegraBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cfg = useRef({ tiempo, densidad, velocidad, parallax, animales, scrim });

  useEffect(() => {
    cfg.current = { tiempo, densidad, velocidad, parallax, animales, scrim };
  }, [tiempo, densidad, velocidad, parallax, animales, scrim]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, raf = 0, last = 0;
    const t0 = performance.now();
    const mouse = { x: 0, y: 0, nx: 0, ny: 0 };

    // carga de imágenes
    const base = assetsBase.endsWith("/") ? assetsBase : assetsBase + "/";
    const imgs: Record<string, HTMLImageElement> = {};
    for (const n of ANIMALS) { const im = new Image(); im.src = `${base}${n}.png`; imgs[n] = im; }
    const bgs: Record<string, HTMLImageElement> = {};
    for (const n of BACKGROUNDS) { const im = new Image(); im.src = `${base}bg-${n}.jpg`; bgs[n] = im; }

    let tiempoNow = resolveTiempo(cfg.current.tiempo);
    let fc = fireflyConfig(tiempoNow);
    let glowSprite = makeGlow(fc.rgb);
    let density = 0;

    type Creature = { type: string; fx: number; baseY: number; s: number; bobAmp: number; fly: boolean; bob: number; phase: number };
    let scene: {
      bokeh: { x: number; y: number; r: number; tw: number; sp: number; vx: number }[];
      fireflies: { x: number; y: number; amp: number; ph: number; r: number; vy: number; fl: number; fs: number }[];
      creatures: Creature[];
    };

    const r = () => Math.random() * 6.28;
    const buildFireflies = (n: number) => {
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
        bokeh: Array.from({ length: 11 }, () => ({ x: Math.random() * W, y: H * (0.4 + Math.random() * 0.5), r: 16 + Math.random() * 30, tw: Math.random() * 6.28, sp: 0.3 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 5 })),
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
        const img = imgs[cr.type];
        if (!img || !img.complete || !img.naturalWidth) continue;
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

    const draw = (t: number, dt: number, animalesOn: boolean, scrimOn: boolean) => {
      ctx.clearRect(0, 0, W, H);
      // fondo pintado del hero (cover-fit, leve parallax con el mouse)
      const bg = bgs[tiempoNow];
      if (bg && bg.complete && bg.naturalWidth) {
        const iw = bg.naturalWidth, ih = bg.naturalHeight;
        const sc = Math.max(W / iw, H / ih);
        const dw = iw * sc, dh = ih * sc;
        const ox = mouse.x * -14, oy = mouse.y * -10;
        ctx.drawImage(bg, (W - dw) / 2 + ox, (H - dh) / 2 - H * 0.04 + oy, dw, dh);
      } else {
        ctx.fillStyle = "#0c1622"; ctx.fillRect(0, 0, W, H);
      }
      if (animalesOn) drawCreatures(dt);
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

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (canvas.clientWidth > 0 && (canvas.clientWidth !== W || canvas.clientHeight !== H)) resize();
      const c = cfg.current;
      const tm = resolveTiempo(c.tiempo);
      if (tm !== tiempoNow) {
        tiempoNow = tm; fc = fireflyConfig(tm); glowSprite = makeGlow(fc.rgb);
      }
      if (Math.round(c.densidad) !== density) buildFireflies(Math.round(c.densidad));
      const t = (now - t0) / 1000;
      let dt = (now - (last || now)) / 1000; last = now;
      dt = Math.min(0.05, dt) * c.velocidad;
      const targetX = c.parallax && !reduce ? mouse.nx : 0;
      const targetY = c.parallax && !reduce ? mouse.ny : 0;
      mouse.x += (targetX - mouse.x) * 0.06;
      mouse.y += (targetY - mouse.y) * 0.06;
      draw(t, dt, c.animales, c.scrim);
    };

    const onResize = () => resize();
    const onMove = (e: MouseEvent) => { mouse.nx = (e.clientX / window.innerWidth) * 2 - 1; mouse.ny = (e.clientY / window.innerHeight) * 2 - 1; };
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMove);
    resize();
    initScene();
    if (reduce) {
      // respeta reduce-motion: un frame estático cuando carguen las imágenes
      const paint = () => draw(0, 0, cfg.current.animales, cfg.current.scrim);
      paint();
      Object.values(bgs).forEach((im) => { im.addEventListener("load", paint); });
      Object.values(imgs).forEach((im) => { im.addEventListener("load", paint); });
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
    };
  }, [assetsBase]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex, display: "block", pointerEvents: "none", WebkitMaskImage: `url(${(assetsBase.endsWith("/") ? assetsBase : assetsBase + "/")}mask.png)`, maskImage: `url(${(assetsBase.endsWith("/") ? assetsBase : assetsBase + "/")}mask.png)`, WebkitMaskSize: "170% 105%", maskSize: "170% 105%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center bottom", maskPosition: "center bottom" }}
    />
  );
}
