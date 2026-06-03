import { getSession, verifyBetSession } from "@/lib/auth";

export type PlayerAuth = { sub: string; npub: string; pubkey: string };

/**
 * Identidad del jugador para endpoints de escrow:
 * - cookie de sesión (páginas first-party de Luna Negra), o
 * - Bearer bet-session token (modal embebido en el juego).
 */
export async function getPlayerAuth(req: Request): Promise<PlayerAuth | null> {
  const session = await getSession();
  if (session) {
    return { sub: session.sub, npub: session.npub, pubkey: session.pubkey };
  }
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const p = await verifyBetSession(auth.slice(7).trim());
    if (p) return p;
  }
  return null;
}
