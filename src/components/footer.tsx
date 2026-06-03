import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/10 py-6 text-center text-xs text-zinc-500">
      <p>🌑 Luna Negra · juegos web con pagos en Bitcoin (Lightning) sobre Nostr</p>
      <p className="mt-2 flex justify-center gap-4">
        <Link href="/terms" className="hover:text-zinc-300">
          Términos
        </Link>
        <Link href="/privacy" className="hover:text-zinc-300">
          Privacidad
        </Link>
      </p>
    </footer>
  );
}
