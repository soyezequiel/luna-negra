import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="mt-2 text-zinc-400">No encontramos esta página.</p>
      <Link
        href="/"
        className="mt-4 inline-block text-sky-400 hover:underline"
      >
        Volver a la tienda
      </Link>
    </div>
  );
}
