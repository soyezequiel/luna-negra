"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { useSession } from "@/providers/session-provider";
import {
  fetchProfiles,
  profileName,
  pubkeyFromNpub,
  shortId,
  type Profile,
} from "@/lib/nostr-social";

type Entry = { npub: string; score: number; rank: number; viaNostr: boolean };
type Board = { name: string; entries: Entry[] };
type Standing = {
  board: string;
  score: number;
  rank: number;
  total: number;
  viaNostr: boolean;
};

const MEDALS = ["🥇", "🥈", "🥉"] as const;

/** Capitaliza el nombre de tabla para la pestaña ("victorias" → "Victorias"). */
function boardLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Tablas cuyo puntaje es una DURACIÓN en milisegundos (se muestra como tiempo, no
// como número pelado — si no, "5 min 53 s" aparece como "353.367" y parece un conteo
// gigante). El juego elige el nombre; estos son los de convención tiempo/supervivencia.
// Provisorio hasta que el evento kind:31337 declare su formato con un tag `format`.
const DURATION_BOARDS = new Set([
  "supervivencia",
  "survival",
  "tiempo",
  "time",
  "duracion",
]);

/** Formatea ms como "h:mm:ss" / "m:ss" (sin horas si no llega a una). */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** Muestra el puntaje según la tabla: duración → tiempo; el resto → número. */
function formatScore(boardName: string, score: number): string {
  if (DURATION_BOARDS.has(boardName.toLowerCase())) return formatDuration(score);
  return score.toLocaleString("es-AR");
}

/**
 * Marcador del juego en la página de la tienda. Lee de /api/scores/top (que sale
 * del read-model `Score`, alimentado por la API REST 1.0 y por el sync NGP
 * kind:31337) y resuelve nombre/avatar desde Nostr, igual que <ZapLeaderboard>.
 * Un juego puede tener varias tablas (p. ej. "victorias" y "supervivencia"): se
 * muestran como pestañas. Si no hay ninguna, el componente no renderiza nada.
 *
 * ⚠️ Los puntajes son falsificables (los firma el cliente del jugador): sirven para
 * mostrar rankings, no para repartir dinero.
 */
export function ScoreLeaderboard({ gameId }: { gameId: string }) {
  const { user } = useSession();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [active, setActive] = useState(0);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [standings, setStandings] = useState<Record<string, Standing>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/scores/top?gameId=${encodeURIComponent(gameId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { boards: Board[] };
        if (cancelled) return;
        setBoards(data.boards);
        // Resolvemos perfiles de todos los npubs de todas las tablas de una vez.
        const pubkeys = [
          ...new Set(
            data.boards
              .flatMap((b) => b.entries.map((e) => pubkeyFromNpub(e.npub)))
              .filter((pk): pk is string => pk !== null),
          ),
        ];
        if (pubkeys.length) {
          const map = await fetchProfiles(pubkeys);
          if (!cancelled) setProfiles(map);
        }
      } catch {
        /* el marcador es no crítico: si falla, no mostramos nada */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  // Puesto propio por tabla ("Tu mejor: 4.200 · puesto #7 de 312"). Sin sesión
  // no hay nada que pedir: el marcador público sigue andando igual.
  useEffect(() => {
    if (!user) {
      setStandings({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/scores/me?gameId=${encodeURIComponent(gameId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { standings: Standing[] };
        if (cancelled) return;
        setStandings(Object.fromEntries(data.standings.map((s) => [s.board, s])));
      } catch {
        /* fila "Vos" es un extra: si falla, el marcador sigue mostrando el top */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, user]);

  const current = useMemo(() => boards?.[active] ?? null, [boards, active]);
  const myStanding = current ? standings[current.name] : undefined;
  // Si ya aparecés en el top visible, la fila fijada sería redundante.
  const alreadyInTop = Boolean(
    user && current?.entries.some((e) => e.npub === user.npub),
  );

  // Sin datos aún o sin tablas: no ocupamos espacio (no es un estado de error).
  if (boards !== null && boards.length === 0) return null;

  return (
    <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ln-text">Marcador 🏆</p>
        {boards && boards.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            {boards.map((b, i) => (
              <button
                key={b.name}
                type="button"
                onClick={() => setActive(i)}
                className={`rounded-ln-lg px-2 py-0.5 text-[12px] transition-colors ${
                  i === active
                    ? "bg-ln-corona/20 text-ln-corona-bright"
                    : "text-ln-muted hover:text-ln-text"
                }`}
              >
                {boardLabel(b.name)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ul className="mt-3 space-y-2">
        {current
          ? current.entries.map((e) => {
              const pk = pubkeyFromNpub(e.npub);
              const p = pk ? profiles[pk] : undefined;
              const name = profileName(p, shortId(e.npub));
              return (
                <li key={e.npub} className="flex items-center gap-3">
                  <span className="w-6 shrink-0 text-center text-sm">
                    {MEDALS[e.rank - 1] ?? (
                      <span className="text-ln-faint">{e.rank}</span>
                    )}
                  </span>
                  <Avatar
                    src={p?.picture}
                    seed={pk ?? e.npub}
                    className="h-8 w-8 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ln-text">
                    {name}
                    {e.viaNostr ? (
                      <span
                        title="Puntaje firmado en Nostr (kind:31337)"
                        className="ml-1.5 align-middle text-[11px] text-ln-muted"
                      >
                        ⚡
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ln-corona-bright">
                    {formatScore(current.name, e.score)}
                  </span>
                </li>
              );
            })
          : Array.from({ length: 3 }).map((_, i) => (
              <li
                key={`sk-${i}`}
                className="h-8 animate-pulse rounded-ln-lg bg-white/5"
              />
            ))}
      </ul>

      {/* Puesto propio, fijado abajo. Se omite si ya aparecés en el top de
          arriba (sería redundante) o si no tenés puntaje en esta tabla. */}
      {myStanding && !alreadyInTop ? (
        <div className="mt-2 flex items-center gap-3 border-t border-ln-border pt-2">
          <span className="w-6 shrink-0 text-center text-sm text-ln-faint">
            #{myStanding.rank}
          </span>
          <Avatar src={user?.avatarUrl} seed={user!.npub} className="h-8 w-8 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm text-ln-text">
            Vos
            {myStanding.viaNostr ? (
              <span
                title="Puntaje firmado en Nostr (kind:31337)"
                className="ml-1.5 align-middle text-[11px] text-ln-muted"
              >
                ⚡
              </span>
            ) : null}
            <span className="ml-1.5 text-[11px] text-ln-faint">
              de {myStanding.total}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-ln-corona-bright">
            {formatScore(current!.name, myStanding.score)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
