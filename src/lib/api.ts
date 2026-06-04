import { NextResponse } from "next/server";

// Helpers compartidos del contrato público de la API (devs de juegos).
// Estandarizan CORS, el envelope de error y la extracción del token Bearer.

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

/** Respuesta a un preflight CORS. */
export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Éxito con CORS (y headers extra opcionales). */
export function apiOk(
  data: Record<string, unknown>,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(data, { headers: { ...CORS, ...headers } });
}

/**
 * Error con forma estándar: `{ error: { code, message } }`.
 * `code` es estable para los clientes; `message` es legible.
 */
export function apiError(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { ...CORS, ...headers } },
  );
}

/**
 * Token de acceso desde `Authorization: Bearer <token>` (estándar).
 * Fallback a `?token=` para compatibilidad con la API vieja (deprecado).
 */
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    const t = auth.replace(/^Bearer\s+/i, "").trim();
    if (t) return t;
  }
  const q = new URL(req.url).searchParams.get("token");
  return q?.trim() || null;
}

/** Headers que marcan una ruta como deprecada, apuntando a su sucesora. */
export function deprecatedHeaders(successorPath: string): Record<string, string> {
  return {
    Deprecation: "true",
    Link: `<${successorPath}>; rel="successor-version"`,
  };
}
