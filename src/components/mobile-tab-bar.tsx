"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useFriendsDrawer } from "@/providers/friends-drawer";

// Tab bar inferior — solo móvil (<880px). Activo en corona; "Amigos" abre el
// drawer de la barra de amigos en vez de navegar.
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const { open, toggle } = useFriendsDrawer();

  const itemClass = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
      active ? "text-ln-corona" : "text-ln-muted hover:text-ln-text",
    );

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-ln-border bg-ln-panel/95 backdrop-blur ln:hidden">
      <Link href="/" className={itemClass(isActive(pathname, "/"))}>
        <span className="text-lg leading-none">◎</span>
        Tienda
      </Link>
      <Link
        href="/library"
        className={itemClass(isActive(pathname, "/library"))}
      >
        <span className="text-lg leading-none">▦</span>
        Biblioteca
      </Link>
      <Link href="/bets" className={itemClass(isActive(pathname, "/bets"))}>
        <span className="text-lg leading-none">◆</span>
        Apuestas
      </Link>
      <button type="button" onClick={toggle} className={itemClass(open)}>
        <span className="text-lg leading-none">◉</span>
        Amigos
      </button>
      <Link
        href="/provider"
        className={itemClass(isActive(pathname, "/provider"))}
      >
        <span className="text-lg leading-none">▲</span>
        Proveedor
      </Link>
    </nav>
  );
}
