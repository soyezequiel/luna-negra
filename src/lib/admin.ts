/**
 * Admin = el pubkey en ADMIN_PUBKEY (hex). En dev, si no está seteado,
 * cualquier usuario logueado puede aprobar (para poder probar el flujo).
 */
export function isAdmin(pubkey: string | undefined): boolean {
  if (!pubkey) return false;
  const admin = process.env.ADMIN_PUBKEY?.toLowerCase();
  if (admin) return pubkey.toLowerCase() === admin;
  return process.env.NODE_ENV !== "production";
}

/**
 * Estado de un juego "publicado pero oculto": no aparece en el catálogo público
 * ni se anuncia en Nostr; solo el admin y el proveedor dueño pueden ver la ficha
 * y jugarlo. Sirve para que el admin pruebe un juego en producción antes de
 * abrirlo al público. Pasarlo a "published" (aprobar normal) lo hace público.
 */
export const ADMIN_ONLY_STATUS = "admin_only";

/**
 * ¿Esta sesión puede ver/acceder un juego oculto (`admin_only`)? El admin
 * siempre; el proveedor dueño del juego, para poder probarlo antes de publicar.
 */
export function canViewHiddenGame(
  pubkey: string | undefined,
  userId: string | undefined,
  providerOwnerId: string,
): boolean {
  if (isAdmin(pubkey)) return true;
  return Boolean(userId) && userId === providerOwnerId;
}
