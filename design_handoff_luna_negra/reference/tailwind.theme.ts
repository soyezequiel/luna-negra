/* ============================================================
   LUNA NEGRA — Tailwind theme extension ("Eclipse")
   Pegá esto en tailwind.config.ts → theme.extend
   Luego usá: bg-ln-luna, text-ln-corona-bright, font-display, etc.
   ============================================================ */

import type { Config } from "tailwindcss";

export const lunaNegraTheme: Config["theme"] = {
  extend: {
    colors: {
      ln: {
        bg: "#08070c",
        "bg-deep": "#050409",
        panel: "#110f18",
        card: "#181522",
        // Luna — periwinkle (acción primaria / nav / identidad)
        luna: { DEFAULT: "#9d8cff", bright: "#c2b5ff", deep: "#7d6cf0" },
        // Corona — oro (dinero: sats / Lightning / comprar / apostar)
        corona: { DEFAULT: "#ffb648", bright: "#ffcd7a" },
        // Aurora — menta (jugar / online / social / éxito)
        aurora: { DEFAULT: "#4fe6a8", bright: "#84f3c6" },
        danger: "#e8907a",
        // texto
        text: "#e9e6f2",
        soft: "#cfc8de",
        muted: "#9a93ad",
        faint: "#5f5872",
      },
    },
    fontFamily: {
      display: ['"Bricolage Grotesque"', "sans-serif"],
      sans: ['"Geist"', "system-ui", "sans-serif"],
      mono: ['"Geist Mono"', "ui-monospace", "monospace"],
    },
    borderRadius: {
      "ln-sm": "9px",
      "ln-md": "13px",
      "ln-lg": "18px",
      "ln-xl": "22px",
    },
    backgroundImage: {
      "ln-luna": "linear-gradient(120deg, #c2b5ff, #9d8cff)",
      "ln-corona": "linear-gradient(120deg, #ffcd7a, #ffb648)",
      "ln-aurora": "linear-gradient(120deg, #84f3c6, #4fe6a8)",
      "ln-eclipse":
        "radial-gradient(1100px 760px at 82% -12%, rgba(157,140,255,.16), transparent 58%), radial-gradient(820px 620px at 88% 4%, rgba(255,182,72,.10), transparent 60%), radial-gradient(900px 900px at 8% 108%, rgba(79,230,168,.06), transparent 60%), #08070c",
    },
    boxShadow: {
      "ln-luna": "0 14px 36px -12px rgba(157,140,255,.70)",
      "ln-corona": "0 14px 30px -14px rgba(255,182,72,.80)",
      "ln-aurora": "0 12px 26px -14px rgba(79,230,168,.80)",
      "ln-card": "0 22px 48px -22px rgba(157,140,255,.55)",
      "ln-modal": "0 40px 100px -30px rgba(0,0,0,.95)",
    },
    keyframes: {
      "ln-corona": {
        "0%,100%": { opacity: "0.55", transform: "scale(1)" },
        "50%": { opacity: "0.9", transform: "scale(1.04)" },
      },
      "ln-shimmer": {
        "0%": { backgroundPosition: "-420px 0" },
        "100%": { backgroundPosition: "420px 0" },
      },
      "ln-rise": {
        from: { transform: "translateY(16px)", opacity: "0" },
        to: { transform: "translateY(0)", opacity: "1" },
      },
      "ln-ping": {
        "0%": { transform: "scale(.6)", opacity: ".8" },
        "80%,100%": { transform: "scale(2.4)", opacity: "0" },
      },
    },
    animation: {
      "ln-corona": "ln-corona 7s ease-in-out infinite",
      "ln-shimmer": "ln-shimmer 1.4s linear infinite",
      "ln-rise": "ln-rise .5s ease both",
      "ln-ping": "ln-ping 1.4s ease-out infinite",
    },
  },
};
