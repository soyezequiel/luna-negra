import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-sky-500 text-white hover:bg-sky-400",
        variant === "outline" &&
          "border border-white/15 text-zinc-200 hover:bg-white/5",
        variant === "ghost" && "text-zinc-300 hover:bg-white/5",
        className,
      )}
      {...props}
    />
  );
}
