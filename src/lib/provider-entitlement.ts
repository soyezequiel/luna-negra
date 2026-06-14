import { prisma } from "@/lib/prisma";

// Helpers de pertenencia jugador↔proveedor, compartidos por los endpoints v1 que
// usa el game server (presencia, invitaciones). Sirven para que un proveedor no
// pueda reportar presencia ni mandar invitaciones en nombre de jugadores que no
// tienen nada que ver con sus juegos (anti-spoofing / anti-spam).

/**
 * ¿El usuario (por npub) tiene acceso a algún juego del proveedor? Acceso =
 * compra pagada de un juego del proveedor, o que el proveedor tenga un juego
 * publicado gratis (cualquier usuario registrado lo "posee"). Requiere que el
 * npub sea una cuenta registrada en Luna Negra.
 */
export async function npubHasProviderEntitlement(
  npub: string,
  providerId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { npub },
    select: { id: true },
  });
  if (!user) return false;

  const paid = await prisma.purchase.findFirst({
    where: { userId: user.id, status: "paid", game: { providerId } },
    select: { id: true },
  });
  if (paid) return true;

  const free = await prisma.game.findFirst({
    where: { providerId, status: "published", priceSats: 0 },
    select: { id: true },
  });
  return Boolean(free);
}

/** ¿El npub tiene presencia viva (TTL vigente) en algún juego del proveedor? */
export async function npubHasLivePresence(
  npub: string,
  providerId: string,
): Promise<boolean> {
  const row = await prisma.gamePresence.findFirst({
    where: { providerId, npub, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return Boolean(row);
}

/** Hosts (lowercased) de los `gameUrl` de los juegos publicados del proveedor. */
export async function providerGameHosts(
  providerId: string,
): Promise<Set<string>> {
  const games = await prisma.game.findMany({
    where: { providerId, status: "published", gameUrl: { not: null } },
    select: { gameUrl: true },
  });
  const hosts = new Set<string>();
  for (const g of games) {
    if (!g.gameUrl) continue;
    try {
      hosts.add(new URL(g.gameUrl).host.toLowerCase());
    } catch {
      /* gameUrl mal formada → se ignora */
    }
  }
  return hosts;
}
