/**
 * Identificador del build en curso. Cambia en cada deploy para que el cliente
 * pueda detectar que está corriendo una versión vieja y recargar (ver
 * `FreshGuard`). Se resuelve una sola vez al cargar el módulo, así que es
 * estable para todo el proceso del server (un único contenedor en el self-host)
 * y vuelve a cambiar cuando el contenedor reinicia tras un deploy.
 *
 * Orden de preferencia:
 *   1. `NEXT_PUBLIC_BUILD_ID` — si el pipeline lo fija (p. ej. el SHA de git).
 *   2. Timestamp de arranque del proceso — proxy fiable de "nuevo deploy" en el
 *      self-host, donde cada release reinicia el contenedor.
 *
 * El fallback vive en `globalThis` porque Next/Turbopack puede evaluar este
 * módulo en chunks distintos (por ejemplo, layout y Route Handler). Si cada
 * copia ejecutara su propio `Date.now()`, FreshGuard interpretaría que hay un
 * deploy nuevo en cada consulta y recargaría la pestaña. Además de formar un
 * loop en desarrollo, esa recarga corta las sesiones BAL efímeras de los juegos.
 */
const buildState = globalThis as typeof globalThis & {
  __lunaNegraBuildId?: string;
};

export const BUILD_ID =
  process.env.NEXT_PUBLIC_BUILD_ID ||
  (buildState.__lunaNegraBuildId ??= String(Date.now()));
