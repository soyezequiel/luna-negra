"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { PlayButton } from "@/components/play-button";
import { NgeBadge, NgpBadge } from "@/components/game-card";
import { hueFromSlug } from "@/lib/format";
import { normalizeImageUrl } from "@/lib/game-media";

type LibraryGame = {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  gameUrl: string | null;
  balCompatible: boolean;
  free: boolean;
  ngpActive: number;
  ngpTotal: number;
  ngeIntegrated: boolean;
};

function Cover({
  game,
  className,
  defaultAspect = "aspect-[16/9]",
}: {
  game: LibraryGame;
  className?: string;
  defaultAspect?: string;
}) {
  // El contenedor adopta la orientación de la portada: horizontal → 16:9,
  // vertical → 2:3 (estilo cápsula). Así no se recorta ni se "agranda".
  const [orientation, setOrientation] = useState<
    "landscape" | "portrait" | null
  >(null);
  const aspect =
    orientation === "portrait"
      ? "aspect-[2/3]"
      : orientation === "landscape"
        ? "aspect-[16/9]"
        : defaultAspect;

  return (
    <div
      className={`cover relative overflow-hidden rounded-ln-lg border border-ln-border ${aspect} ${className ?? ""}`}
      style={{ "--h": hueFromSlug(game.slug) } as CSSProperties}
    >
      {game.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={normalizeImageUrl(game.coverUrl)}
          alt={game.title}
          referrerPolicy="no-referrer"
          onLoad={(e) =>
            setOrientation(
              e.currentTarget.naturalHeight > e.currentTarget.naturalWidth
                ? "portrait"
                : "landscape",
            )
          }
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-sm font-semibold text-white/90">
          {game.title}
        </div>
      )}
      {/* Sello NGP: mismas capacidades activas que la tienda. */}
      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
        <NgpBadge active={game.ngpActive} total={game.ngpTotal} />
      </div>
      <div className="absolute bottom-2 left-2 z-10">
        <NgeBadge enabled={game.ngeIntegrated} />
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const { user, login, loading } = useSession();
  const [games, setGames] = useState<LibraryGame[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => setGames(d.games ?? []))
      .catch(() => setGames([]));
  }, [user]);

  async function removeFromLibrary(g: LibraryGame) {
    if (!confirm(`¿Quitar "${g.title}" de tu biblioteca?`)) return;
    setRemoving(g.id);
    try {
      const r = await fetch(`/api/games/${g.id}/library`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error ?? "No se pudo quitar");
        return;
      }
      setGames((prev) => (prev ? prev.filter((x) => x.id !== g.id) : prev));
    } finally {
      setRemoving(null);
    }
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-[1240px] px-[22px] py-16 text-center">
        <h1 className="font-display text-3xl font-extrabold text-white">
          Tu biblioteca
        </h1>
        <p className="mt-2 text-ln-muted">
          Iniciá sesión para ver tus juegos.
        </p>
        <div className="mt-4 flex justify-center">
          <Button variant="luna" onClick={login}>
            Iniciar sesión
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-[22px] py-8">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
          Tu biblioteca
        </h1>
        {games && games.length > 0 ? (
          <span className="font-mono text-xs text-ln-faint">
            {games.length} {games.length === 1 ? "juego" : "juegos"}
          </span>
        ) : null}
      </div>

      {games === null ? (
        <p className="mt-4 text-sm text-ln-faint">Cargando…</p>
      ) : games.length === 0 ? (
        <p className="mt-4 text-ln-muted">
          Todavía no tenés juegos.{" "}
          <Link href="/" className="text-ln-luna hover:underline">
            Ir a la tienda
          </Link>
          .
        </p>
      ) : (
        <>
          <section className="mt-10">
            <h2 className="mb-3 text-[17px] font-semibold text-ln-text">
              Todos tus juegos
            </h2>
            <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
              {games.map((g) => (
                <div key={g.id} className="group">
                  <Link href={`/game/${g.slug}`} className="block">
                    <Cover game={g} defaultAspect="aspect-[16/10]" />
                  </Link>
                  <p className="mt-2 truncate text-sm text-ln-text">{g.title}</p>
                  <div className="mt-2 flex gap-2">
                    {g.gameUrl ? (
                      <PlayButton
                        gameId={g.id}
                        gameUrl={g.gameUrl}
                        title={g.title}
                        slug={g.slug}
                        balCompatible={g.balCompatible}
                        variant="play"
                        size="sm"
                        label="▶ Jugar"
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
                      Ver
                    </Link>
                    {g.free ? (
                      <button
                        type="button"
                        onClick={() => removeFromLibrary(g)}
                        disabled={removing === g.id}
                        className="btn btn-ghost px-3 py-1.5 text-[13px] text-ln-faint hover:text-[var(--lose)]"
                      >
                        {removing === g.id ? "Quitando…" : "Quitar"}
                      </button>
                    ) : null}
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
