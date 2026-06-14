"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { publishGameReview, type GameRoot } from "@/lib/nostr-social";

type Review = {
  id: string;
  rating: number;
  body: string;
  npub: string;
  name: string | null;
  avatarUrl: string | null;
};

function Stars({ n }: { n: number }) {
  return (
    <span className="text-ln-corona" aria-label={`${n} de 5`}>
      {"★".repeat(n)}
      <span className="text-ln-faint">{"★".repeat(5 - n)}</span>
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
  const [sending, setSending] = useState(false);
  // Guard síncrono: setSending no alcanza contra un doble click más rápido
  // que el re-render, y cada envío extra publica otro evento en Nostr.
  const sendingRef = useRef(false);
  const [, startLoadTransition] = useTransition();

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
    startLoadTransition(() => {
      void load();
    });
  }, [load, startLoadTransition]);

  async function submit() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setMsg(null);
    try {
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
          return void load();
        }
      }

      setText("");
      setMsg("¡Gracias por tu reseña!");
      void load();
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[19px] font-semibold text-ln-text">
          Reseñas de la comunidad
        </h2>
        {count > 0 ? (
          <span className="text-sm text-muted">
            <Stars n={Math.round(average)} /> {average.toFixed(1)} · {count}
          </span>
        ) : null}
      </div>

      {owned ? (
        <div className="mb-6 rounded border border-line bg-panel p-4">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                className={
                  n <= rating ? "text-xl text-ln-corona" : "text-xl text-ln-faint"
                }
                aria-label={`${n} estrellas`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            className="mt-3 w-full rounded-sm border border-line bg-black/20 px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-blue/30"
            rows={3}
            placeholder="¿Qué te pareció?"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-3">
            <Button variant="blue" onClick={submit} disabled={sending}>
              {sending ? "Publicando…" : "Publicar reseña"}
            </Button>
            {msg ? <span className="text-sm text-blue">{msg}</span> : null}
          </div>
        </div>
      ) : (
        <p className="mb-6 text-sm text-faint">
          Comprá el juego para dejar una reseña.
        </p>
      )}

      {reviews === null ? (
        <p className="text-sm text-faint">Cargando…</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-faint">Todavía no hay reseñas.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {reviews.map((r) => (
            <li key={r.id} className="rounded border border-line bg-panel p-4">
              <div className="flex items-center gap-2">
                <Avatar
                  src={r.avatarUrl}
                  seed={r.name ?? r.npub}
                  className="h-7 w-7 shrink-0"
                />
                <Stars n={r.rating} />
                <span className="font-mono text-xs text-faint">
                  {r.name ?? r.npub.slice(0, 12) + "…"}
                </span>
              </div>
              {r.body ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
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
