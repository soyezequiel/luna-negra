import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Sistema de color con significado fijo (ver IMPLEMENTATION_PROMPT §0):
//  - blue  -> tienda / navegación
//  - play  -> jugar / entrar / instalar / ganar / online
//  - btc   -> SOLO dinero (sats, billetera, comprar, apostar, escrow, LN)
// Las variantes viejas (primary/outline/ghost) siguen compilando.
type Variant = "primary" | "outline" | "ghost" | "play" | "blue" | "btc";
type Size = "sm" | "md" | "xl";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      className={cn(
        "btn",
        // primary es alias de blue para no romper llamadas existentes.
        (variant === "primary" || variant === "blue") && "btn-blue",
        variant === "play" && "btn-play",
        variant === "btc" && "btn-btc",
        // outline y ghost comparten el look ghost del nuevo sistema.
        (variant === "outline" || variant === "ghost") && "btn-ghost",
        size === "sm" && "px-3 py-1.5 text-[13px]",
        size === "xl" && "btn-xl",
        className,
      )}
      {...props}
    />
  );
}
