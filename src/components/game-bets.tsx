"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { satsLabel } from "@/lib/format";
import { betStatusLabel, betTone, toneAccent } from "@/lib/bet-ui";

type MineBet = {
  id: string;
  gameId: string;
  gameSlug: string;
  gameTitle: string;
  status: string;
  stakeSats: number;
  result: string;
};

/** "Tus apuestas en {juego}" — lista filtrada por juego (modo biblioteca). */
export function GameBets({
  gameId,
  title,
}: {
  gameId: string;
  title: string;
}) {
  const { user } = useSession();
  const [bets, setBets] = useState<MineBet[] | null>(null);
  const [, startLoadTransition] = useTransition();

  useEffect(() => {
    if (!user) {
      startLoadTransition(() => {
        setBets([]);
      });
      return;
    }
    fetch("/api/escrow/bets/mine")
      .then((r) => r.json())
      .then((d: { bets?: MineBet[] }) =>
        startLoadTransition(() => {
          setBets((d.bets ?? []).filter((b) => b.gameId === gameId));
        }),
      )
      .catch(() =>
        startLoadTransition(() => {
          setBets([]);
        }),
      );
  }, [user, gameId, startLoadTransition]);

  return (
    <section>
      <h2 className="mb-3 text-[17px] font-semibold text-ink">
        Tus apuestas en {title}
      </h2>
      {bets === null ? (
        <p className="text-sm text-faint">Cargando…</p>
      ) : bets.length === 0 ? (
        <div className="rounded border border-line bg-panel p-5 text-center">
          <p className="text-sm text-muted">
            Todavía no apostaste en este juego.
          </p>
          <p className="mt-1 text-xs text-faint">
            Usá “Crear apuesta 1v1” para desafiar a un amigo.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {bets.map((b) => {
            const tone = betTone(b.status, b.result);
            return (
              <li key={b.id}>
                <Link
                  href={`/bets/${b.id}`}
                  className="flex items-center justify-between gap-3 rounded border border-line border-l-[3px] bg-panel px-4 py-3 transition-colors hover:bg-white/[.02]"
                  style={{ borderLeftColor: toneAccent(tone) }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">
                      {betStatusLabel(b.status)}
                      {b.status === "settled" && b.result === "won"
                        ? " · ganaste"
                        : b.status === "settled" && b.result === "lost"
                          ? " · perdiste"
                          : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-btc">
                    {satsLabel(b.stakeSats)} sats
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
