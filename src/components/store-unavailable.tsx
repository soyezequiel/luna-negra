import Link from "next/link";

// Estado degradado: se muestra cuando la base de datos no responde (p. ej. Neon
// sin cuota de compute) en vez de tirar un 500 crudo. La tienda sigue navegable y
// el mensaje deja claro que es temporal, no que "no hay juegos".
export function StoreUnavailable({ href = "/" }: { href?: string }) {
  return (
    <div className="mx-auto max-w-[1240px] px-[22px] py-24 text-center">
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-white">
        No pudimos cargar la tienda
      </h1>
      <p className="mx-auto mt-3 max-w-md text-ln-muted">
        Estamos con un problema temporal en la base de datos. Probá de nuevo en
        unos minutos.
      </p>
      <Link href={href} className="btn btn-ghost mt-6 inline-block">
        Reintentar
      </Link>
    </div>
  );
}
