"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";

type LibraryGame = {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  gameUrl: string | null;
};

export default function LibraryPage() {
  const { user, login, loading } = useSession();
  const [games, setGames] = useState<LibraryGame[] | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => setGames(d.games ?? []))
      .catch(() => setGames([]));
  }, [user]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Tu biblioteca</h1>
        <p className="mt-2 text-zinc-400">
          Conectá tu Nostr para ver tus juegos.
        </p>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-bold">Tu biblioteca</h1>
      {games === null ? (
        <p className="mt-2 text-sm text-zinc-500">Cargando…</p>
      ) : games.length === 0 ? (
        <p className="mt-2 text-zinc-400">
          Todavía no tenés juegos.{" "}
          <Link href="/" className="text-sky-400 hover:underline">
            Ir a la tienda
          </Link>
          .
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {games.map((g) => (
            <div key={g.id} className="flex flex-col gap-2">
              <Link href={`/game/${g.slug}`} className="block">
                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-sky-900/40 to-zinc-900 p-3 text-center text-sm font-semibold text-zinc-300">
                  {g.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={g.coverUrl}
                      alt={g.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    g.title
                  )}
                </div>
              </Link>
              {g.gameUrl ? (
                <a href={g.gameUrl} target="_blank" rel="noopener noreferrer">
                  <Button className="w-full">Jugar</Button>
                </a>
              ) : (
                <Button variant="outline" className="w-full" disabled>
                  Sin enlace
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
