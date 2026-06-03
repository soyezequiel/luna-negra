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
