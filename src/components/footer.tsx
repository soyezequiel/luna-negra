import Link from "next/link";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-line py-6 text-center text-xs text-faint xl:pr-80">
      <p>🌑 Luna Negra · juegos web con pagos en Bitcoin (Lightning) sobre Nostr</p>
      <p className="mt-2 flex justify-center gap-4">
        <Link href="/terms" className="hover:text-ink">
          Términos
        </Link>
        <Link href="/privacy" className="hover:text-ink">
          Privacidad
        </Link>
      </p>
    </footer>
  );
}
