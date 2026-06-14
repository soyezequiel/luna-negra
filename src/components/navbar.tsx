"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import { useWallet } from "@/providers/wallet-provider";
import { satsLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

// Orden fijo: Tienda · Biblioteca · Apuestas | Proveedor · Admin.
// "Amigos" sale del nav principal (se accede desde el panel derecho de amigos).
// "Mensajes" sale del nav principal (el chat vive en la barra de amigos).
const STORE_LINKS = [
  { href: "/", label: "Tienda" },
  { href: "/library", label: "Biblioteca" },
  { href: "/bets", label: "Apuestas" },
];
const ROLE_LINKS = [{ href: "/provider", label: "Proveedor" }];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Navbar() {
  const { user, login, logout, loading, error } = useSession();
  const { connected, balanceSats } = useWallet();
  const pathname = usePathname() ?? "/";

  const navLink = (href: string, label: string) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "relative rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
          active
            ? "bg-ln-luna/15 text-white ring-1 ring-inset ring-ln-luna/25"
            : "text-ln-soft hover:bg-white/5 hover:text-white",
        )}
      >
        {label}
        {active ? (
          <span className="absolute -bottom-px left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-ln-corona" />
        ) : null}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-50 border-b border-ln-border bg-gradient-to-b from-ln-panel/90 to-ln-bg/80 backdrop-blur">
      <div className="mx-auto flex h-[66px] max-w-[1240px] items-center gap-3 px-[22px]">
        {/* Logo eclipse + wordmark */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 font-display text-[17px] font-extrabold tracking-tight text-white"
        >
          <span
            className="h-[26px] w-[26px] rounded-full bg-[#0a0810]"
            style={{
              boxShadow:
                "0 0 0 1.5px rgba(255,182,72,.55), 0 0 14px -2px rgba(255,182,72,.7), inset 0 0 8px -3px rgba(157,140,255,.6)",
            }}
            aria-hidden
          />
          <span>
            Luna <span className="text-ln-corona">Negra</span>
          </span>
        </Link>

        {/* Links centrales (≥880px) */}
        <nav className="ml-2 hidden min-w-0 items-center gap-1 ln:flex">
          {STORE_LINKS.map((l) => navLink(l.href, l.label))}
          <span
            className="mx-1 h-5 w-px shrink-0 bg-ln-border-strong"
            aria-hidden
          />
          {ROLE_LINKS.map((l) => navLink(l.href, l.label))}
          {user?.isAdmin ? navLink("/admin", "Admin") : null}
        </nav>

        {/* Buscador pill (≥880px) */}
        <form action="/" method="get" className="ml-auto hidden ln:block">
          <input
            name="q"
            placeholder="Buscar juegos…"
            aria-label="Buscar juegos"
            className="w-[180px] rounded-full border border-ln-border bg-ln-bg-deep px-4 py-2 text-[13px] text-ln-text outline-none transition-[width,box-shadow] placeholder:text-ln-faint focus:w-[212px] focus:ring-2 focus:ring-ln-luna/20"
          />
        </form>

        <div className="ml-auto flex shrink-0 items-center gap-3 ln:ml-0">
          {loading ? null : user ? (
            <>
              {connected ? (
                <Link
                  href="/profile/editar"
                  title="Tu saldo Lightning (NWC) · Editar perfil"
                  className="flex items-center gap-1.5 rounded-full border border-ln-corona/40 bg-ln-corona/10 px-3 py-1.5 font-mono text-[13px] font-semibold text-ln-corona-bright transition-colors hover:border-ln-corona/70"
                >
                  <span aria-hidden>⚡</span>
                  <span>{balanceSats != null ? satsLabel(balanceSats) : "…"}</span>
                </Link>
              ) : null}
              <Link
                href="/profile"
                className="flex items-center gap-2 text-sm text-ln-soft transition-colors hover:text-white"
                title="Tu perfil"
              >
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="h-9 w-9 rounded-full border border-ln-luna/40 object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ln-grad-luna font-mono text-xs font-semibold uppercase text-ln-on-luna">
                    {(user.displayName || user.npub).slice(0, 2)}
                  </span>
                )}
                <span className="hidden max-w-[120px] truncate ln:inline">
                  {user.displayName || `${user.npub.slice(0, 12)}…`}
                </span>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="hidden ln:inline-flex"
              >
                Salir
              </Button>
            </>
          ) : (
            <Button variant="luna" size="sm" onClick={login}>
              <span className="ln:hidden">Conectar</span>
              <span className="hidden ln:inline">Conectar con Nostr</span>
            </Button>
          )}
        </div>
      </div>
      {error ? (
        <p className="bg-ln-danger/10 px-4 py-1 text-center text-xs text-ln-danger">
          {error}
        </p>
      ) : null}
    </header>
  );
}
