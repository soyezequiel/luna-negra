"use client";

import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "./ui/button";

export function Navbar() {
  const { user, login, logout, loading, error } = useSession();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0b0d12]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="text-lg">🌑</span>
          <span>Luna Negra</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-zinc-300">
          <Link href="/" className="hover:text-white">
            Tienda
          </Link>
          <Link href="/library" className="hover:text-white">
            Biblioteca
          </Link>
          <Link href="/provider" className="hover:text-white">
            Proveedor
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {loading ? null : user ? (
            <>
              <Link
                href="/profile"
                className="font-mono text-sm text-zinc-300 hover:text-white"
              >
                {user.npub.slice(0, 12)}…
              </Link>
              <Button variant="outline" onClick={logout}>
                Salir
              </Button>
            </>
          ) : (
            <Button onClick={login}>Conectar con Nostr</Button>
          )}
        </div>
      </div>
      {error ? (
        <p className="bg-red-500/10 px-4 py-1 text-center text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </header>
  );
}
