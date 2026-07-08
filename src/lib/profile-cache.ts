import { nip19 } from "nostr-tools";
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

/**
 * Nombre legible por humanos de una pubkey, para textos públicos (ej. el
 * comentario del zap de payout). Cascada: displayName cacheado en User (sin
 * red) → kind:0 en relays (acotado a 3s) → npub abreviado. Nunca lanza.
 */
export async function displayNameForPubkey(pubkey: string): Promise<string> {
  try {
    const u = await prisma.user.findUnique({
      where: { pubkey },
      select: { displayName: true },
    });
    if (u?.displayName) return truncateName(u.displayName);
    const p = await Promise.race([
      fetchProfile(pubkey),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);
    const name = profileName(p);
    if (name) return truncateName(name);
  } catch {
    /* cae al npub abreviado */
  }
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

function truncateName(name: string): string {
  const clean = name.trim();
  return clean.length > 30 ? `${clean.slice(0, 29)}…` : clean;
}
