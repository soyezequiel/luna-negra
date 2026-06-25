// URL pública absoluta del sitio. Se usa para resolver og:image relativos a
// absolutos, armar el sitemap y robots.txt, y los enlaces canónicos. En
// self-host se setea NEXT_PUBLIC_SITE_URL; el fallback es el dominio de prod.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
  "https://luna.naranja.fit";

// Nombre y pitch cortos, reutilizados en metadatos y previews sociales.
export const SITE_NAME = "Luna Negra";
export const SITE_TAGLINE =
  "Tienda de juegos con identidad Nostr y pagos en Lightning (sats).";
