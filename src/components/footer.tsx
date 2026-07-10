import Link from "next/link";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-ln-border py-10 ln:pr-[308px]">
      <div className="mx-auto flex max-w-[1240px] flex-col items-center gap-3 px-[22px] text-center">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-display text-[15px] font-extrabold tracking-tight text-white"
        >
          <span
            className="h-[22px] w-[22px] rounded-full bg-[#0a0810]"
            style={{
              boxShadow:
                "0 0 0 1.5px rgba(255,182,72,.5), 0 0 12px -2px rgba(255,182,72,.6)",
            }}
            aria-hidden
          />
          Luna <span className="text-ln-corona">Negra</span>
        </Link>
        <p className="text-sm text-ln-muted">
          Jugá en el navegador. Pagá con Lightning. Conectá con Nostr.
        </p>
        <nav className="flex flex-wrap justify-center gap-5 text-xs text-ln-faint">
          <Link href="/terms" className="transition-colors hover:text-ln-text">
            Términos
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-ln-text">
            Privacidad
          </Link>
          <Link
            href="/dev"
            className="transition-colors hover:text-ln-text"
          >
            Desarrolladores
          </Link>
          <span>© 2026 Luna Negra</span>
        </nav>
      </div>
    </footer>
  );
}
