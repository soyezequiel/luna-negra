"use client";

import { cn } from "@/lib/utils";
import { useAppMode } from "@/providers/app-mode-provider";

const OPTIONS = [
  {
    value: "bal" as const,
    compact: "BAL",
    label: "Modo BAL",
    title: "BAL: Luna conecta tu identidad y permisos con los juegos compatibles",
  },
  {
    value: "independent" as const,
    compact: "Indep.",
    label: "Independiente",
    title: "Independiente: cada juego gestiona su propia identidad y permisos",
  },
];

export function AppModeSelector() {
  const { mode, setMode } = useAppMode();

  return (
    <div
      role="group"
      aria-label="Selector de modo"
      className="flex h-9 shrink-0 items-center rounded-full border border-ln-border-strong bg-ln-bg-deep/80 p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            title={option.title}
            onClick={() => setMode(option.value)}
            className={cn(
              "h-7 rounded-full px-2 text-[10px] font-semibold transition-colors min-[520px]:px-2.5 min-[520px]:text-[11px]",
              selected
                ? option.value === "bal"
                  ? "bg-ln-luna/25 text-white ring-1 ring-inset ring-ln-luna/40"
                  : "bg-ln-corona/20 text-ln-corona-bright ring-1 ring-inset ring-ln-corona/35"
                : "text-ln-faint hover:text-ln-soft",
            )}
          >
            <span className="min-[520px]:hidden">{option.compact}</span>
            <span className="hidden min-[520px]:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
