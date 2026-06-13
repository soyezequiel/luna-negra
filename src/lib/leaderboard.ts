import { prisma } from "@/lib/prisma";

// Marcador con nombre, genérico y por juego. El `name` lo elige el juego
// ("semanal", "clasico", …). Política "se queda el mejor": una fila por jugador
// con su récord; `updatedAt` marca cuándo lo fijó (filtro de la ventana `week`).
//
// ⚠️ ANTI-TRAMPA: el puntaje lo manda el CLIENTE y es FALSIFICABLE. Sirve para
// MOSTRAR rankings (como Steam), NO para resolver apuestas — el resultado de una
// apuesta sigue viniendo del game server por POST /api/v1/bets/{id}/result.

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const TOP_LIMIT = 100; // entradas devueltas en view=top
const AROUND_RADIUS = 5; // entradas a cada lado del jugador en view=around
const MAX_SCAN = 5000; // tope de filas escaneadas para rankear
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SCORE = 1_000_000_000;

export type LeaderboardEntry = {
  npub: string;
  displayName: string | null;
  score: number;
  rank: number;
};

export function isValidLeaderboardName(name: string): boolean {
  return NAME_RE.test(name);
}

export type SubmitScoreResult =
  | { ok: true; score: number; rank: number; improved: boolean }
  | { ok: false; code: string; message: string; status: number };

/**
 * Sube un puntaje al marcador `name` del juego. Se queda el mejor: si el nuevo
 * no supera al guardado, no cambia nada (`improved: false`). Crea el marcador la
 * primera vez. Devuelve el récord vigente del jugador y su puesto all-time.
 */
export async function submitScore(
  gameId: string,
  name: string,
  npub: string,
  rawScore: unknown,
): Promise<SubmitScoreResult> {
  if (!isValidLeaderboardName(name)) {
    return { ok: false, code: "INVALID_NAME", message: "Nombre de marcador inválido", status: 400 };
  }
  const score = Math.floor(Number(rawScore));
  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
    return { ok: false, code: "INVALID_SCORE", message: "`score` debe ser un entero entre 0 y 1e9", status: 400 };
  }

  const board = await prisma.leaderboard.upsert({
    where: { gameId_name: { gameId, name } },
    create: { gameId, name },
    update: {},
  });

  const existing = await prisma.score.findUnique({
    where: { leaderboardId_npub: { leaderboardId: board.id, npub } },
    select: { score: true },
  });

  let best = score;
  let improved = true;
  if (existing && existing.score >= score) {
    best = existing.score;
    improved = false;
  }
  if (improved) {
    await prisma.score.upsert({
      where: { leaderboardId_npub: { leaderboardId: board.id, npub } },
      create: { leaderboardId: board.id, npub, score },
      update: { score },
    });
  }

  // Puesto all-time (empates comparten puesto, estilo "competition ranking").
  const better = await prisma.score.count({
    where: { leaderboardId: board.id, score: { gt: best } },
  });
  return { ok: true, score: best, rank: better + 1, improved };
}

export type ReadLeaderboardOptions = {
  window: "all" | "week";
  view: "top" | "around";
  npub: string | null;
};

/**
 * Lee el marcador `name` del juego. `window=week` filtra a quienes fijaron su
 * récord en los últimos 7 días. `view=top` devuelve el top; `view=around`
 * devuelve la vecindad del jugador `npub`. Marcador inexistente → `{ entries: [] }`.
 */
export async function readLeaderboard(
  gameId: string,
  name: string,
  opts: ReadLeaderboardOptions,
  now = Date.now(),
): Promise<{ entries: LeaderboardEntry[] }> {
  if (!isValidLeaderboardName(name)) return { entries: [] };
  const board = await prisma.leaderboard.findUnique({
    where: { gameId_name: { gameId, name } },
    select: { id: true },
  });
  if (!board) return { entries: [] };

  const rows = await prisma.score.findMany({
    where: {
      leaderboardId: board.id,
      ...(opts.window === "week" ? { updatedAt: { gte: new Date(now - WEEK_MS) } } : {}),
    },
    orderBy: [{ score: "desc" }, { updatedAt: "asc" }],
    take: MAX_SCAN,
    select: { npub: true, score: true },
  });
  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  let slice: typeof ranked;
  if (opts.view === "around") {
    const idx = opts.npub ? ranked.findIndex((r) => r.npub === opts.npub) : -1;
    if (idx === -1) slice = [];
    else slice = ranked.slice(Math.max(0, idx - AROUND_RADIUS), idx + AROUND_RADIUS + 1);
  } else {
    slice = ranked.slice(0, TOP_LIMIT);
  }

  const npubs = [...new Set(slice.map((s) => s.npub))];
  const users = npubs.length
    ? await prisma.user.findMany({
        where: { npub: { in: npubs } },
        select: { npub: true, displayName: true },
      })
    : [];
  const byNpub = new Map(users.map((u) => [u.npub, u.displayName]));

  return {
    entries: slice.map((s) => ({
      npub: s.npub,
      displayName: byNpub.get(s.npub) ?? null,
      score: s.score,
      rank: s.rank,
    })),
  };
}
