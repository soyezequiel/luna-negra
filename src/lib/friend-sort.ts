/**
 * Orden compartido de la lista de amigos (cliente y server, puro y testeable):
 *   tier 0 — jugando AHORA (presencia NIP-38 fresca o GamePresence vigente)
 *   tier 1 — jugó alguna vez en Luna Negra (User.lastPlayedAt)
 *   tier 2 — tiene cuenta en Luna Negra (isMember)
 *   tier 3 — resto de los follows
 * Dentro del tier 1 gana el que jugó más recientemente; en los demás, alfabético.
 */

export type FriendRankInput = {
  playingNow: boolean;
  lastPlayedAt: number | null;
  isMember: boolean;
};

export function friendTier(f: FriendRankInput): 0 | 1 | 2 | 3 {
  if (f.playingNow) return 0;
  if (f.lastPlayedAt !== null) return 1;
  if (f.isMember) return 2;
  return 3;
}

export function compareFriends(
  a: FriendRankInput & { name: string },
  b: FriendRankInput & { name: string },
): number {
  const ta = friendTier(a);
  const tb = friendTier(b);
  if (ta !== tb) return ta - tb;
  if (ta === 1 && a.lastPlayedAt !== b.lastPlayedAt) {
    return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0);
  }
  return a.name.localeCompare(b.name);
}
