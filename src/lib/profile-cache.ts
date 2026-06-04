import { prisma } from "@/lib/prisma";
import { fetchProfile, profileName } from "@/lib/nostr";

/**
 * Trae el perfil Nostr (kind:0) desde relays y lo cachea en User (best-effort).
 * Server-side, para no depender de que el cliente lo cachee al login. Pensado
 * para correr en background (next/server `after`). Bounded a 3s.
 */
export async function cacheProfile(
  pubkey: string,
): Promise<{ displayName: string | null; avatarUrl: string | null } | null> {
  try {
    const p = await Promise.race([
      fetchProfile(pubkey),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
    if (!p) return null;
    const name = profileName(p);
    const avatar = p.picture ?? null;
    if (!name && !avatar) return null;
    await prisma.user.update({
      where: { pubkey },
      data: {
        ...(name ? { displayName: name } : {}),
        ...(avatar ? { avatarUrl: avatar } : {}),
      },
    });
    return { displayName: name, avatarUrl: avatar };
  } catch {
    /* best-effort: si falla, queda el fallback a npub */
    return null;
  }
}
