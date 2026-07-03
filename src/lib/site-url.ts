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

export const STORE_LNURL_USERNAME = "luna";

/** Endpoint LNURL-pay estable publicado en el perfil Nostr de Luna Negra. */
export function storeLnurlUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/.well-known/lnurlp/${STORE_LNURL_USERNAME}`;
}

/** Lightning Address publica de Luna Negra, derivada del dominio canonico. */
export function storeLightningAddress(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || !url.hostname) return null;
    return `${STORE_LNURL_USERNAME}@${url.hostname}`;
  } catch {
    return null;
  }
}

/** URL absoluta a la ficha de un juego. */
export function gamePageUrl(req: Request, slug: string): string {
  return `${siteUrl(req)}/game/${slug}`;
}
