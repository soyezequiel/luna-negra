import sanitizeHtml from "sanitize-html";

/**
 * Saneado de la descripción de un juego cuando viene como HTML enriquecido
 * (estilo ficha de Steam). Los proveedores pueden subir/pegar HTML, así que
 * SIEMPRE pasamos por esta lista blanca antes de guardar y antes de renderizar
 * para evitar XSS almacenado.
 *
 * Permitido: texto enriquecido, listas, enlaces, imágenes, tablas, y vídeos
 * embebidos solo de YouTube/Vimeo. Sin <script>, sin eventos on*, sin estilos
 * arbitrarios (solo un set controlado).
 */

// Solo permitimos iframes de estos hosts de vídeo.
const ALLOWED_IFRAME_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
];

// Patrones de color aceptados en estilos en línea.
const COLOR = [
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i,
  /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)$/i,
  /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)$/i,
];

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr", "blockquote", "pre", "code",
    "strong", "b", "em", "i", "u", "s", "del", "ins", "mark",
    "small", "sub", "sup", "span", "div",
    "ul", "ol", "li",
    "a", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "caption", "colgroup", "col",
    "iframe",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    iframe: [
      "src", "width", "height", "allow", "allowfullscreen",
      "frameborder", "title", "loading", "referrerpolicy",
    ],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
    col: ["span"],
    colgroup: ["span"],
    "*": ["style"],
  },
  allowedStyles: {
    "*": {
      "text-align": [/^(?:left|right|center|justify)$/],
      "font-weight": [/^(?:normal|bold|[1-9]00)$/],
      "font-style": [/^(?:normal|italic)$/],
      "text-decoration": [/^(?:none|underline|line-through)$/],
      color: COLOR,
      "background-color": COLOR,
      width: [/^\d{1,4}(?:px|%)$/],
      "max-width": [/^\d{1,4}(?:px|%)$/],
      height: [/^\d{1,4}(?:px|%)$/],
    },
  },
  // http(s)/mailto en enlaces; data: e http(s) en imágenes embebidas.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  allowedIframeHostnames: ALLOWED_IFRAME_HOSTS,
  allowIframeRelativeUrls: false,
  transformTags: {
    // Los enlaces externos abren en pestaña nueva y sin filtrar referer.
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    }),
  },
};

/** Sanea HTML enriquecido de descripción. Devuelve cadena segura para render. */
export function sanitizeDescriptionHtml(input: string): string {
  return sanitizeHtml(input ?? "", SANITIZE_OPTS);
}

/** Heurística: ¿la descripción contiene marcado HTML (vs. texto plano)? */
export function descriptionLooksLikeHtml(input: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(input ?? "");
}
