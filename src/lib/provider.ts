import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/auth";

/** Devuelve el proveedor + juego si el juego pertenece al proveedor del usuario. */
export async function ownedGame(session: SessionPayload, id: string) {
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  if (!provider) return null;
  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || game.providerId !== provider.id) return null;
  return { provider, game };
}
