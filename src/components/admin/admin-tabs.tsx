"use client";

import { cn } from "@/lib/utils";

export type AdminTab = "juegos" | "economia" | "apuestas" | "integracion";

export const ADMIN_TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: "juegos", label: "Juegos", icon: "🎮" },
  { id: "economia", label: "Economía", icon: "💰" },
  { id: "apuestas", label: "Apuestas", icon: "🎲" },
  { id: "integracion", label: "Integración", icon: "🔌" },
];

export function AdminTabBar({
  active,
  onChange,
  badges,
}: {
  active: AdminTab;
  onChange: (tab: AdminTab) => void;
  badges?: Partial<Record<AdminTab, number>>;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-panel p-1">
      {ADMIN_TABS.map((tab) => {
        const isActive = active === tab.id;
        const badge = badges?.[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-all whitespace-nowrap",
              isActive
                ? "bg-white/10 text-ink shadow-sm"
                : "text-muted hover:bg-white/5 hover:text-ink",
            )}
          >
            <span className="text-base">{tab.icon}</span>
            {tab.label}
            {badge != null && badge > 0 ? (
              <span
                className={cn(
                  "ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none",
                  isActive
                    ? "bg-blue/20 text-blue"
                    : "bg-white/10 text-faint",
                )}
              >
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
