/**
 * URL base absoluta de la tienda. Prefiere `NEXT_PUBLIC_SITE_URL` (dominio
 * canónico en prod); si no está, cae al origin de la request (útil en dev y
 * previews de Vercel). Sin barra final.
 */
export function siteUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const base = env && env.length > 0 ? env : new URL(req.url).origin;
  return base.replace(/\/$/, "");
}

/** URL absoluta a la ficha de un juego. */
export function gamePageUrl(req: Request, slug: string): string {
  return `${siteUrl(req)}/game/${slug}`;
}
