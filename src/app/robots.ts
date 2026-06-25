import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Le dice a los crawlers qué pueden indexar. Lo público (home + fichas de juego)
// se permite; lo que requiere sesión o no aporta a búsqueda se bloquea (perfil,
// biblioteca, mensajes, notificaciones, panel de provider/admin, flujos de auth y
// toda la API). Apunta al sitemap para acelerar el descubrimiento.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/provider",
        "/profile",
        "/library",
        "/messages",
        "/notifications",
        "/friends",
        "/auth/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
