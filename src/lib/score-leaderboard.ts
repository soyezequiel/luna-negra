export type ScoreStanding = {
  board: string;
  score: number;
  rank: number;
  total: number;
  viaNostr: boolean;
};

export type UserScoreStandings = {
  npub: string;
  byBoard: Record<string, ScoreStanding>;
};

/**
 * El puesto propio llega de forma asíncrona y puede pertenecer a una sesión
 * anterior. Nunca lo exponemos sin usuario activo ni a otra identidad.
 */
export function authenticatedStanding(
  user: { npub: string } | null,
  boardName: string | null,
  standings: UserScoreStandings | null,
): ScoreStanding | null {
  if (!user || !boardName || standings?.npub !== user.npub) return null;
  return standings.byBoard[boardName] ?? null;
}
