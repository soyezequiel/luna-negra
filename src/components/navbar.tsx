"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

// Orden fijo: Tienda · Biblioteca · Apuestas · Amigos | Proveedor · Admin.
// "Mensajes" sale del nav principal (el chat vive en la barra de amigos).
const STORE_LINKS = [
  { href: "/", label: "Tienda" },
  { href: "/library", label: "Biblioteca" },
  { href: "/bets", label: "Apuestas" },
  { href: "/friends", label: "Amigos" },
];
const ROLE_LINKS = [{ href: "/provider", label: "Proveedor" }];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Navbar() {
  const { user, login, logout, loading, error } = useSession();
  const pathname = usePathname() ?? "/";

  const navLink = (href: string, label: string) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "rounded-sm px-3 py-2 text-[12px] font-medium uppercase tracking-wide transition-colors",
          active
            ? "bg-blue/15 text-white ring-1 ring-inset ring-blue/40"
            : "text-[#b8c6d4] hover:bg-white/10 hover:text-white",
        )}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-50 border-b border-[#05080c] bg-gradient-to-b from-panel to-bg-1 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-white"
        >
          <span className="text-lg">🌑</span>
          <span className="hidden sm:inline">Luna Negra</span>
        </Link>

        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap">
          {STORE_LINKS.map((l) => navLink(l.href, l.label))}
          <span className="mx-1 h-5 w-px shrink-0 bg-line-2" aria-hidden />
          {ROLE_LINKS.map((l) => navLink(l.href, l.label))}
          {user?.isAdmin ? navLink("/admin", "Admin") : null}
        </nav>

        <form action="/" method="get" className="ml-auto hidden md:block">
          <input
            name="q"
            placeholder="Buscar juegos…"
            aria-label="Buscar juegos"
            className="w-44 rounded-sm border border-line bg-black/30 px-3 py-1.5 text-sm text-ink outline-none transition-shadow placeholder:text-faint focus:ring-2 focus:ring-blue/30"
          />
        </form>

        <div className="flex shrink-0 items-center gap-3 md:ml-0">
          {loading ? null : user ? (
            <>
              <Link
                href="/profile"
                className="flex items-center gap-2 text-sm text-ink hover:text-white"
                title="Tu perfil"
              >
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="h-8 w-8 rounded-full border border-line-2 object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line-2 bg-panel-3 text-xs font-mono uppercase text-muted">
                    {(user.displayName || user.npub).slice(0, 2)}
                  </span>
                )}
                <span className="hidden max-w-[120px] truncate lg:inline">
                  {user.displayName || `${user.npub.slice(0, 12)}…`}
                </span>
              </Link>
              <Button variant="ghost" size="sm" onClick={logout}>
                Salir
              </Button>
            </>
          ) : (
            <Button variant="blue" size="sm" onClick={login}>
              Conectar con Nostr
            </Button>
          )}
        </div>
      </div>
      {error ? (
        <p className="bg-[var(--lose)]/10 px-4 py-1 text-center text-xs text-[var(--lose)]">
          {error}
        </p>
      ) : null}
    </header>
  );
}
