import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Sistema de color Eclipse con significado fijo:
//  - luna   -> acción primaria / navegación / identidad   (alias: blue, primary)
//  - corona -> dinero (sats, Lightning, comprar, apostar)  (alias: btc)
//  - aurora -> jugar / entrar a sala / online / éxito      (alias: play)
//  - ghost  -> secundario neutro                           (alias: outline)
// Los nombres viejos siguen compilando para no romper llamadas existentes.
type Variant =
  | "luna"
  | "corona"
  | "aurora"
  | "ghost"
  | "primary"
  | "outline"
  | "blue"
  | "btc"
  | "play";
type Size = "sm" | "md" | "xl";

export function Button({
  className,
  variant = "luna",
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
        (variant === "luna" || variant === "blue" || variant === "primary") &&
          "btn-luna",
        (variant === "corona" || variant === "btc") && "btn-corona",
        (variant === "aurora" || variant === "play") && "btn-aurora",
        (variant === "ghost" || variant === "outline") && "btn-ghost",
        size === "sm" && "px-3.5 py-1.5 text-[13px]",
        size === "xl" && "btn-xl",
        className,
      )}
      {...props}
    />
  );
}
