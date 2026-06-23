import { prisma } from "@/lib/prisma";
import { fetchProfile } from "@/lib/nostr";

/**
 * Resuelve a dónde mandar una propina al desarrollador de un juego. Cascada
 * análoga a la de los payouts (ver resolveDestination en escrow-payout.ts), pero
 * apuntando al PROVEEDOR, no a un usuario:
 *
 *   provider.lightningAddress  →  owner.lud16  →  lud16 del perfil Nostr (kind:0)
 *
 * Devuelve la Lightning Address contra la que pedir el invoice, o null si el dev
 * todavía no configuró ninguna forma de cobro (la propina no se puede ofrecer).
 */
export async function resolveTipDestination(
  providerId: string,
): Promise<string | null> {
  const provider = await prisma.provider
    .findUnique({
      where: { id: providerId },
      select: {
        lightningAddress: true,
        owner: { select: { lud16: true, pubkey: true } },
      },
    })
    .catch(() => null);
  if (!provider) return null;

  if (provider.lightningAddress) return provider.lightningAddress;
  if (provider.owner?.lud16) return provider.owner.lud16;

  const pk = provider.owner?.pubkey;
  if (!pk) return null;
  const profile = await fetchProfile(pk).catch(() => null);
  return profile?.lud16 ?? null;
}
