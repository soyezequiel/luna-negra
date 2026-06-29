"use client";

/**
 * Luna Negra — fondo animado (pradera con luciérnagas + animales).
 * Componente client autónomo: dibuja todo en un <canvas> fijo detrás de la app.
 *
 * Uso (App Router): montalo UNA vez, alto en el árbol (p. ej. en app/layout.tsx,
 * justo dentro de <body>, antes del contenido):
 *
 *   import LunaNegraBackground from "@/components/LunaNegraBackground";
 *   ...
 *   <body>
 *     <LunaNegraBackground />        // tiempo="auto" -> según la hora real
 *     <div className="relative z-[1]">{children}</div>
 *   </body>
 *
 * Asegurate de que tu contenido tenga un z-index por encima (p. ej. relative z-[1])
 * y que paneles/secciones que quieras "calmados" lleven un fondo semitransparente
 * oscuro (rgba(8,7,12,.9)) para atenuar la animación detrás de ellos.
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
  /** Mostrar los animales en la pradera. */
  animales?: boolean;
  /** Clase extra para el <canvas> (el componente ya lo fija a pantalla completa). */
  className?: string;
  /** z-index del canvas. Por defecto 0 (poné tu contenido en z-index >= 1). */
  zIndex?: number;
}

type Pal = {
  skyTop: string; skyMid: string; skyHorizon: string; glow: string;
  star: string; starA: number; hills: string[];
  eye: string; beak: string; rim: string;
  fly: [number, number, number]; flyAlpha: number; cloudRGB: [number, number, number];
};

function makePalette(t: string): Pal {
  if (t === "dia") return { skyTop: "#3f74ad", skyMid: "#84afcf", skyHorizon: "#ecd9ad", glow: "rgba(255,232,180,0.5)", star: "#ffffff", starA: 0, hills: ["#5d8a73", "#3f6e55", "#2f5642", "#1d3b2b"], eye: "#2a2230", beak: "#ff9a3c", rim: "rgba(255,240,210,0.55)", fly: [255, 250, 230], flyAlpha: 0.28, cloudRGB: [255, 255, 255] };
  if (t === "noche") return { skyTop: "#06050f", skyMid: "#0e0f2a", skyHorizon: "#241c42", glow: "rgba(157,140,255,0.30)", star: "#dfe0ff", starA: 0.95, hills: ["#241c3e", "#172a3c", "#0e2128", "#070f12"], eye: "#c2b5ff", beak: "#ffb648", rim: "rgba(157,140,255,0.5)", fly: [190, 233, 200], flyAlpha: 1, cloudRGB: [60, 55, 95] };
  if (t === "amanecer") return { skyTop: "#20204a", skyMid: "#5a4668", skyHorizon: "#d59266", glow: "rgba(255,200,150,0.5)", star: "#e9e6f2", starA: 0.35, hills: ["#3c2f59", "#3d4a4c", "#2a4038", "#101c18"], eye: "#fff0d0", beak: "#ff9a3c", rim: "rgba(255,205,150,0.5)", fly: [255, 224, 160], flyAlpha: 0.8, cloudRGB: [200, 170, 185] };
  return { skyTop: "#171232", skyMid: "#3a2452", skyHorizon: "#7a3f54", glow: "rgba(255,182,72,0.42)", star: "#cfc8de", starA: 0.6, hills: ["#3a2a55", "#284a49", "#163a32", "#0b1a1c"], eye: "#ffcd7a", beak: "#ffb648", rim: "rgba(255,205,122,0.45)", fly: [255, 205, 122], flyAlpha: 1, cloudRGB: [95, 78, 150] };
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
  className = "",
  zIndex = 0,
}: LunaNegraBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // refs vivos para que el loop lea valores actualizados sin reiniciar
  const cfg = useRef({ tiempo, densidad, velocidad, parallax, animales });
  cfg.current = { tiempo, densidad, velocidad, parallax, animales };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, raf = 0, last = 0;
    const t0 = performance.now();
    const mouse = { x: 0, y: 0, nx: 0, ny: 0 };
    let tiempoNow = resolveTiempo(cfg.current.tiempo);
    let pal = makePalette(tiempoNow);
    const sprites = { cloud: makeGlow(pal.cloudRGB), glow: makeGlow(pal.fly) };
    let density = 0;
    const creatureLayer = 2;

    type Hill = { by: number; amp: number; fq: number; ph: number; col: string; px: number };
    type Creature = { type: string; fx: number; s: number; bob: number; blink: number; blinking: number };
    let scene: {
      stars: { x: number; y: number; r: number; tw: number; sp: number }[];
      clouds: { x: number; y: number; s: number; v: number; a: number }[];
      bokeh: { x: number; y: number; r: number; tw: number; sp: number; vx: number }[];
      fireflies: { x: number; y: number; amp: number; ph: number; r: number; vy: number; fl: number; fs: number }[];
      hills: Hill[];
      creatures: Creature[];
      spark: { active: boolean; next: number; x: number; y: number; vx: number; vy: number; life: number };
    };

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
        stars: Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.5, r: Math.random() * 1.4 + 0.4, tw: Math.random() * 6.28, sp: Math.random() * 1.5 + 0.4 })),
        clouds: Array.from({ length: 5 }, () => ({ x: Math.random() * W, y: H * (0.08 + Math.random() * 0.24), s: 130 + Math.random() * 170, v: 3 + Math.random() * 6, a: 0.045 + Math.random() * 0.06 })),
        bokeh: Array.from({ length: 11 }, () => ({ x: Math.random() * W, y: H * (0.4 + Math.random() * 0.5), r: 16 + Math.random() * 30, tw: Math.random() * 6.28, sp: 0.3 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 5 })),
        fireflies: [],
        hills: [
          { by: 0.62, amp: 34, fq: 0.0016, ph: 0.0, col: pal.hills[0], px: 6 },
          { by: 0.71, amp: 44, fq: 0.0021, ph: 1.3, col: pal.hills[1], px: 12 },
          { by: 0.81, amp: 30, fq: 0.0027, ph: 2.6, col: pal.hills[2], px: 21 },
          { by: 0.93, amp: 26, fq: 0.0033, ph: 0.6, col: pal.hills[3], px: 36 },
        ],
        creatures: [
          { type: "cat", fx: 0.16, s: 1.05, bob: Math.random() * 6.28, blink: 1.0 + Math.random() * 3, blinking: 0 },
          { type: "bunny", fx: 0.40, s: 0.95, bob: Math.random() * 6.28, blink: 2.0 + Math.random() * 3, blinking: 0 },
          { type: "fox", fx: 0.72, s: 1.12, bob: Math.random() * 6.28, blink: 1.5 + Math.random() * 3, blinking: 0 },
          { type: "bird", fx: 0.88, s: 0.74, bob: Math.random() * 6.28, blink: 1.2 + Math.random() * 3, blinking: 0 },
        ],
        spark: { active: false, next: 3 + Math.random() * 4, x: 0, y: 0, vx: 0, vy: 0, life: 0 },
      };
      buildFireflies(Math.round(cfg.current.densidad));
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (scene) initScene();
    };

    const hillY = (L: Hill, x: number) => H * L.by + L.amp * Math.sin(x * L.fq + L.ph);

    const drawHill = (L: Hill) => {
      const ox = mouse.x * L.px, oy = mouse.y * L.px * 0.25;
      ctx.beginPath(); ctx.moveTo(-50, H + 30);
      for (let x = -50; x <= W + 50; x += 12) ctx.lineTo(x, hillY(L, x - ox) + oy);
      ctx.lineTo(W + 50, H + 30); ctx.closePath();
      ctx.fillStyle = L.col; ctx.fill();
    };

    const rim = (P: Pal, x: number, y: number, r: number) => {
      ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = P.rim; ctx.lineWidth = 1.6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(x, y, r * 0.9, Math.PI * 1.18, Math.PI * 1.92); ctx.stroke(); ctx.restore();
    };

    const drawEye = (x: number, y: number, open: boolean, s: number, P: Pal) => {
      if (open) {
        ctx.globalCompositeOperation = "lighter";
        const g = 15 * s; ctx.globalAlpha = 0.85; ctx.drawImage(sprites.glow, x - g / 2, y - g / 2, g, g);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = P.eye; ctx.beginPath(); ctx.arc(x, y, 2.4 * s, 0, 6.3); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(x - 0.7 * s, y - 0.8 * s, 0.9 * s, 0, 6.3); ctx.fill();
      } else {
        ctx.strokeStyle = P.eye; ctx.lineWidth = 1.7 * s; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x - 2.6 * s, y); ctx.lineTo(x + 2.6 * s, y); ctx.stroke();
      }
    };

    const drawCritter = (P: Pal, type: string, cx: number, gy: number, s: number, open: boolean) => {
      const E = (x: number, y: number, rx: number, ry: number, rot: number, col: string) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, 6.3); ctx.fillStyle = col; ctx.fill(); };
      const T = (ax: number, ay: number, bx: number, by: number, dx: number, dy: number, col: string) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(dx, dy); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };

      if (type === "cat") {
        const base = "#46415e", dark = "#37324c", belly = "#5d5878", ear = "#8a6678", nose = "#e8a0a8";
        E(cx + 16 * s, gy - 13 * s, 6 * s, 12 * s, 0.6, dark);
        E(cx + 21 * s, gy - 23 * s, 4 * s, 4 * s, 0, belly);
        E(cx - 7 * s, gy - 3 * s, 5 * s, 3.2 * s, 0, belly); E(cx + 7 * s, gy - 3 * s, 5 * s, 3.2 * s, 0, belly);
        E(cx, gy - 15 * s, 15 * s, 16 * s, 0, base);
        E(cx, gy - 12 * s, 9 * s, 11 * s, 0, belly);
        E(cx - 6 * s, gy - 4 * s, 4 * s, 3 * s, 0, belly); E(cx + 6 * s, gy - 4 * s, 4 * s, 3 * s, 0, belly);
        E(cx, gy - 36 * s, 13 * s, 13 * s, 0, base);
        T(cx - 12 * s, gy - 44 * s, cx - 5 * s, gy - 58 * s, cx - 1 * s, gy - 45 * s, base);
        T(cx - 10 * s, gy - 46 * s, cx - 5.5 * s, gy - 54 * s, cx - 3 * s, gy - 46 * s, ear);
        T(cx + 12 * s, gy - 44 * s, cx + 5 * s, gy - 58 * s, cx + 1 * s, gy - 45 * s, base);
        T(cx + 10 * s, gy - 46 * s, cx + 5.5 * s, gy - 54 * s, cx + 3 * s, gy - 46 * s, ear);
        E(cx, gy - 31 * s, 7 * s, 5 * s, 0, belly);
        T(cx - 2.2 * s, gy - 33 * s, cx + 2.2 * s, gy - 33 * s, cx, gy - 30 * s, nose);
        rim(P, cx, gy - 36 * s, 13 * s);
        ctx.strokeStyle = "rgba(20,16,30,0.4)"; ctx.lineWidth = 0.8 * s; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cx, gy - 30 * s); ctx.lineTo(cx, gy - 28.5 * s); ctx.moveTo(cx, gy - 28.5 * s); ctx.lineTo(cx - 2.2 * s, gy - 27.5 * s); ctx.moveTo(cx, gy - 28.5 * s); ctx.lineTo(cx + 2.2 * s, gy - 27.5 * s); ctx.stroke();
        drawEye(cx - 5.5 * s, gy - 37 * s, open, s, P);
        drawEye(cx + 5.5 * s, gy - 37 * s, open, s, P);
      } else if (type === "bunny") {
        const base = "#5a5270", dark = "#48405e", belly = "#6f6786", ear = "#9a7888", nose = "#e8a0a8", tail = "#d8d2e4";
        E(cx - 12 * s, gy - 8 * s, 5 * s, 5 * s, 0, tail);
        E(cx - 7 * s, gy - 3 * s, 4.5 * s, 3 * s, 0, belly); E(cx + 7 * s, gy - 3 * s, 4.5 * s, 3 * s, 0, belly);
        E(cx, gy - 13 * s, 13 * s, 15 * s, 0, base);
        E(cx, gy - 10 * s, 8 * s, 10 * s, 0, belly);
        E(cx - 5 * s, gy - 3.5 * s, 3.5 * s, 2.6 * s, 0, belly); E(cx + 5 * s, gy - 3.5 * s, 3.5 * s, 2.6 * s, 0, belly);
        E(cx, gy - 32 * s, 11 * s, 11 * s, 0, base);
        E(cx - 5 * s, gy - 48 * s, 4 * s, 15 * s, -0.14, base); E(cx - 5 * s, gy - 48 * s, 2 * s, 11 * s, -0.14, ear);
        E(cx + 5 * s, gy - 48 * s, 4 * s, 15 * s, 0.14, base); E(cx + 5 * s, gy - 48 * s, 2 * s, 11 * s, 0.14, ear);
        E(cx, gy - 28 * s, 6 * s, 4.5 * s, 0, belly);
        T(cx - 1.8 * s, gy - 30 * s, cx + 1.8 * s, gy - 30 * s, cx, gy - 27.5 * s, nose);
        rim(P, cx, gy - 32 * s, 11 * s);
        drawEye(cx - 4.5 * s, gy - 33 * s, open, s, P);
        drawEye(cx + 4.5 * s, gy - 33 * s, open, s, P);
      } else if (type === "fox") {
        const base = "#b06a3c", dark = "#8a4f2c", belly = "#e8d6b4", earin = "#3a2418", nose = "#241c2a";
        E(cx + 15 * s, gy - 12 * s, 9 * s, 13 * s, 0.5, dark);
        E(cx + 22 * s, gy - 21 * s, 5.5 * s, 6 * s, 0.3, belly);
        E(cx - 7 * s, gy - 3 * s, 5 * s, 3.2 * s, 0, dark); E(cx + 7 * s, gy - 3 * s, 5 * s, 3.2 * s, 0, dark);
        E(cx, gy - 15 * s, 15 * s, 16 * s, 0, base);
        E(cx, gy - 12 * s, 9 * s, 11 * s, 0, belly);
        E(cx, gy - 37 * s, 13 * s, 12 * s, 0, base);
        T(cx - 13 * s, gy - 43 * s, cx - 9 * s, gy - 60 * s, cx - 2 * s, gy - 46 * s, base);
        T(cx - 11 * s, gy - 45 * s, cx - 8.5 * s, gy - 55 * s, cx - 4 * s, gy - 46 * s, earin);
        T(cx + 13 * s, gy - 43 * s, cx + 9 * s, gy - 60 * s, cx + 2 * s, gy - 46 * s, base);
        T(cx + 11 * s, gy - 45 * s, cx + 8.5 * s, gy - 55 * s, cx + 4 * s, gy - 46 * s, earin);
        E(cx - 6 * s, gy - 33 * s, 6 * s, 7 * s, 0, belly); E(cx + 6 * s, gy - 33 * s, 6 * s, 7 * s, 0, belly);
        E(cx, gy - 30 * s, 5 * s, 5 * s, 0, belly);
        E(cx, gy - 27 * s, 2.2 * s, 1.8 * s, 0, nose);
        rim(P, cx, gy - 37 * s, 13 * s);
        drawEye(cx - 5.5 * s, gy - 37 * s, open, s, P);
        drawEye(cx + 5.5 * s, gy - 37 * s, open, s, P);
      } else {
        const base = "#d8b24a", dark = "#b58f2e", belly = "#f0d98a", beak = P.beak;
        T(cx + 10 * s, gy - 20 * s, cx + 18 * s, gy - 16 * s, cx + 10 * s, gy - 12 * s, dark);
        ctx.strokeStyle = beak; ctx.lineWidth = 1.4 * s; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cx - 3 * s, gy - 1 * s); ctx.lineTo(cx - 3 * s, gy + 2 * s); ctx.moveTo(cx + 3 * s, gy - 1 * s); ctx.lineTo(cx + 3 * s, gy + 2 * s); ctx.stroke();
        E(cx, gy - 13 * s, 12 * s, 13 * s, 0, base);
        E(cx, gy - 10 * s, 7.5 * s, 9 * s, 0, belly);
        E(cx + 7 * s, gy - 14 * s, 5 * s, 8 * s, -0.3, dark);
        T(cx - 10 * s, gy - 16 * s, cx - 18 * s, gy - 14 * s, cx - 10 * s, gy - 11 * s, beak);
        E(cx, gy - 27 * s, 2.4 * s, 4 * s, 0, dark);
        rim(P, cx, gy - 18 * s, 12 * s);
        drawEye(cx - 5 * s, gy - 17 * s, open, s, P);
        drawEye(cx + 1 * s, gy - 17 * s, open, s, P);
      }
    };

    const drawCreatures = (dt: number) => {
      const L = scene.hills[creatureLayer];
      const ox = mouse.x * L.px, oy = mouse.y * L.px * 0.25;
      for (const cr of scene.creatures) {
        cr.bob += dt * 1.2;
        cr.blink -= dt;
        if (cr.blink <= 0) { cr.blinking = 0.12; cr.blink = 2.4 + Math.random() * 3.6; }
        if (cr.blinking > 0) cr.blinking -= dt;
        const cx = W * cr.fx + ox;
        const gy = hillY(L, W * cr.fx) + oy - Math.sin(cr.bob) * 2.4 * cr.s + 3;
        drawCritter(pal, cr.type, cx, gy, cr.s, cr.blinking <= 0);
      }
    };

    const drawFireflies = (t: number, dt: number) => {
      const fa = pal.flyAlpha;
      ctx.globalCompositeOperation = "lighter";
      for (const f of scene.bokeh) {
        f.tw += dt * f.sp; f.x += f.vx * dt;
        if (f.x < -70) f.x = W + 70; if (f.x > W + 70) f.x = -70;
        const b = (0.05 + 0.06 * (0.5 + 0.5 * Math.sin(f.tw))) * fa;
        const sz = f.r * 4; ctx.globalAlpha = b;
        ctx.drawImage(sprites.glow, f.x - sz / 2, f.y - sz / 2, sz, sz);
      }
      for (const f of scene.fireflies) {
        f.y -= f.vy * dt; f.ph += dt;
        if (f.y < H * 0.30) { f.y = H * 1.04; f.x = Math.random() * W; }
        const sx = f.x + Math.sin(f.ph * 0.6 + f.fl) * f.amp * 0.4;
        const b = (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * f.fs * 2.2 + f.fl))) * fa;
        const sz = f.r * 9; ctx.globalAlpha = b;
        ctx.drawImage(sprites.glow, sx - sz / 2, f.y - sz / 2, sz, sz);
        ctx.globalAlpha = Math.min(1, b + 0.2 * fa); ctx.fillStyle = "#fffceb";
        ctx.beginPath(); ctx.arc(sx, f.y, f.r * 0.6, 0, 6.3); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    };

    const drawSpark = (dt: number) => {
      const sp = scene.spark;
      if (!sp.active) {
        sp.next -= dt;
        if (sp.next <= 0) { sp.active = true; sp.x = W * (0.55 + Math.random() * 0.4); sp.y = H * (0.04 + Math.random() * 0.12); sp.vx = -(W * 0.45 + Math.random() * W * 0.25); sp.vy = H * (0.12 + Math.random() * 0.1); sp.life = 0; }
        return;
      }
      sp.life += dt; sp.x += sp.vx * dt; sp.y += sp.vy * dt;
      const fade = Math.max(0, Math.min(1, Math.min(sp.life * 4, (1.15 - sp.life) * 4)));
      ctx.globalCompositeOperation = "lighter";
      const tx = sp.x - sp.vx * 0.05, ty = sp.y - sp.vy * 0.05;
      const lg = ctx.createLinearGradient(sp.x, sp.y, tx, ty);
      lg.addColorStop(0, `rgba(255,221,150,${0.9 * fade})`); lg.addColorStop(1, "rgba(255,221,150,0)");
      ctx.strokeStyle = lg; ctx.lineWidth = 2.2; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(tx, ty); ctx.stroke();
      const sz = 28 * fade; ctx.globalAlpha = fade; ctx.drawImage(sprites.glow, sp.x - sz / 2, sp.y - sz / 2, sz, sz);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      if (sp.life > 1.15 || sp.x < -70) { sp.active = false; sp.next = 6 + Math.random() * 10; }
    };

    const draw = (t: number, dt: number, animalesOn: boolean) => {
      const P = pal;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, P.skyTop); g.addColorStop(0.55, P.skyMid); g.addColorStop(1, P.skyHorizon);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      const rg = ctx.createRadialGradient(W * 0.68, H * 0.6, 0, W * 0.68, H * 0.6, H * 0.7);
      rg.addColorStop(0, P.glow); rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = P.star;
      for (const st of scene.stars) { st.tw += dt * st.sp; ctx.globalAlpha = P.starA * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(st.tw))); ctx.fillRect(st.x, st.y, st.r, st.r); }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "lighter";
      for (const cl of scene.clouds) { cl.x += cl.v * dt; if (cl.x - cl.s > W) cl.x = -cl.s; ctx.globalAlpha = cl.a; ctx.drawImage(sprites.cloud, cl.x - cl.s, cl.y - cl.s * 0.5, cl.s * 2, cl.s); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < scene.hills.length; i++) {
        drawHill(scene.hills[i]);
        if (animalesOn && i === creatureLayer) drawCreatures(dt);
      }
      drawFireflies(t, dt);
      drawSpark(dt);
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.42, H * 0.15, W * 0.5, H * 0.5, H * 0.95);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(4,3,8,0.5)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      const bf = ctx.createLinearGradient(0, H * 0.72, 0, H);
      bf.addColorStop(0, "rgba(8,7,12,0)"); bf.addColorStop(1, "rgba(8,7,12,0.92)");
      ctx.fillStyle = bf; ctx.fillRect(0, H * 0.72, W, H * 0.28);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const c = cfg.current;
      const tm = resolveTiempo(c.tiempo);
      if (tm !== tiempoNow) {
        tiempoNow = tm; pal = makePalette(tm);
        sprites.glow = makeGlow(pal.fly);
        sprites.cloud = makeGlow(pal.cloudRGB);
        scene.hills.forEach((h, i) => { h.col = pal.hills[i]; });
      }
      if (Math.round(c.densidad) !== density) buildFireflies(Math.round(c.densidad));
      const t = (now - t0) / 1000;
      let dt = (now - (last || now)) / 1000; last = now;
      dt = Math.min(0.05, dt) * c.velocidad;
      const targetX = c.parallax && !reduce ? mouse.nx : 0;
      const targetY = c.parallax && !reduce ? mouse.ny : 0;
      mouse.x += (targetX - mouse.x) * 0.06;
      mouse.y += (targetY - mouse.y) * 0.06;
      draw(t, dt, c.animales);
    };

    const onResize = () => resize();
    const onMove = (e: MouseEvent) => { mouse.nx = (e.clientX / window.innerWidth) * 2 - 1; mouse.ny = (e.clientY / window.innerHeight) * 2 - 1; };
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMove);
    resize();
    initScene();
    if (reduce) {
      // respeta reduce-motion: pinta un frame estático
      draw(0, 0, cfg.current.animales);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex, display: "block", pointerEvents: "none" }}
    />
  );
}
