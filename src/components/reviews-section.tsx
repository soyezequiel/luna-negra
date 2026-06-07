"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { publishGameReview, type GameRoot } from "@/lib/nostr-social";

type Review = {
  id: string;
  rating: number;
  body: string;
  npub: string;
  name: string | null;
};

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-400" aria-label={`${n} de 5`}>
      {"★".repeat(n)}
      <span className="text-zinc-600">{"★".repeat(5 - n)}</span>
    </span>
  );
}

export function ReviewsSection({
  gameId,
  owned,
  title,
  slug,
  root,
}: {
  gameId: string;
  owned: boolean;
  title: string;
  slug: string;
  root: GameRoot | null;
}) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [average, setAverage] = useState(0);
  const [count, setCount] = useState(0);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await fetch(`/api/games/${gameId}/reviews`)
      .then((r) => r.json())
      .catch(() => null);
    if (d) {
      setReviews(d.reviews);
      setAverage(d.average);
      setCount(d.count);
    }
  }, [gameId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setMsg(null);
    const r = await fetch(`/api/games/${gameId}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, body: text }),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "Error");

    // Además del registro en la DB, publicamos la reseña como respuesta al
    // anuncio del juego en Nostr (firmada por el usuario). Best-effort: si falla
    // o no hay anuncio, la reseña igual queda guardada.
    if (root) {
      try {
        const gameUrl = `${window.location.origin}/game/${slug}`;
        await publishGameReview(root, rating, text, title, gameUrl);
      } catch {
        setMsg("Reseña guardada (no se pudo publicar en Nostr).");
        setText("");
        return load();
      }
    }

    setText("");
    setMsg("¡Gracias por tu reseña!");
    load();
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">Reseñas</h2>
        {count > 0 ? (
          <span className="text-sm text-zinc-400">
            <Stars n={Math.round(average)} /> {average.toFixed(1)} · {count}
          </span>
        ) : null}
      </div>

      {owned ? (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className={
                  n <= rating ? "text-xl text-amber-400" : "text-xl text-zinc-600"
                }
                aria-label={`${n} estrellas`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            className="mt-3 w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-500/50"
            rows={3}
            placeholder="¿Qué te pareció?"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={submit}>Publicar reseña</Button>
            {msg ? <span className="text-sm text-sky-400">{msg}</span> : null}
          </div>
        </div>
      ) : (
        <p className="mb-6 text-sm text-zinc-500">
          Comprá el juego para dejar una reseña.
        </p>
      )}

      {reviews === null ? (
        <p className="text-sm text-zinc-500">Cargando…</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-zinc-500">Todavía no hay reseñas.</p>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-white/10 bg-white/5 p-4"
            >
              <div className="flex items-center gap-2">
                <Stars n={r.rating} />
                <span className="font-mono text-xs text-zinc-500">
                  {r.name ?? r.npub.slice(0, 12) + "…"}
                </span>
              </div>
              {r.body ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
                  {r.body}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
