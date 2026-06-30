import { prisma } from "@/lib/prisma";

/**
 * ¿Este usuario ve los juegos marcados beta (`Game.isBeta`) en la tienda? Solo
 * si activó `showBetaGames` en su perfil. Anónimo (sin userId) = false.
 *
 * El dueño del juego y el admin ven los beta SIEMPRE, pero eso se resuelve en la
 * ficha (donde se conoce la propiedad y el pubkey); este helper cubre el opt-in
 * genérico del catálogo, que no depende del juego concreto.
 */
export async function userSeesBetaGames(
  userId: string | undefined | null,
): Promise<boolean> {
  if (!userId) return false;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { showBetaGames: true },
  });
  return u?.showBetaGames ?? false;
}
