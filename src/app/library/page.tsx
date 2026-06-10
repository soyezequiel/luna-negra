"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { PlayButton } from "@/components/play-button";
import { hueFromSlug } from "@/lib/format";

type LibraryGame = {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  gameUrl: string | null;
};

function Cover({
  game,
  className,
}: {
  game: LibraryGame;
  className?: string;
}) {
  return (
    <div
      className={`cover relative overflow-hidden rounded border border-line ${className ?? ""}`}
      style={{ "--h": hueFromSlug(game.slug) } as CSSProperties}
    >
      {game.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={game.coverUrl}
          alt={game.title}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-sm font-semibold text-white/90">
          {game.title}
        </div>
      )}
    </div>
  );
}

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
        <h1 className="text-2xl font-bold text-white">Tu biblioteca</h1>
        <p className="mt-2 text-muted">Conectá tu Nostr para ver tus juegos.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>
            Conectar con Nostr
          </Button>
        </div>
      </div>
    );
  }

  const keepPlaying = games?.slice(0, 3) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-white">
        Tu biblioteca
      </h1>

      {games === null ? (
        <p className="mt-4 text-sm text-faint">Cargando…</p>
      ) : games.length === 0 ? (
        <p className="mt-4 text-muted">
          Todavía no tenés juegos.{" "}
          <Link href="/" className="text-blue hover:underline">
            Ir a la tienda
          </Link>
          .
        </p>
      ) : (
        <>
          {keepPlaying.length > 0 ? (
            <section className="mt-7">
              <h2 className="mb-3 text-[15px] font-semibold text-ink">
                Seguir jugando
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {keepPlaying.map((g) => (
                  <div key={g.id} className="group relative">
                    <Link href={`/game/${g.slug}`} className="block">
                      <Cover game={g} className="aspect-[16/9]" />
                    </Link>
                    {g.gameUrl ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="pointer-events-auto">
                          <PlayButton
                            gameId={g.id}
                            gameUrl={g.gameUrl}
                            title={g.title}
                            slug={g.slug}
                            variant="play"
                            label="Jugar"
                          />
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-2 truncate text-sm text-ink">{g.title}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-9">
            <h2 className="mb-3 text-[15px] font-semibold text-ink">
              Todos tus juegos
            </h2>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
              {games.map((g) => (
                <div key={g.id} className="group">
                  <Link href={`/game/${g.slug}`} className="block">
                    <Cover game={g} className="aspect-[16/10]" />
                  </Link>
                  <p className="mt-2 truncate text-sm text-ink">{g.title}</p>
                  <div className="mt-2 flex gap-2">
                    {g.gameUrl ? (
                      <PlayButton
                        gameId={g.id}
                        gameUrl={g.gameUrl}
                        title={g.title}
                        slug={g.slug}
                        variant="play"
                        size="sm"
                        label="Jugar"
                      />
                    ) : (
                      <Button variant="ghost" size="sm" disabled>
                        Sin enlace
                      </Button>
                    )}
                    <Link
                      href={`/game/${g.slug}`}
                      className="btn btn-ghost px-3 py-1.5 text-[13px]"
                    >
                      Ver juego
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
