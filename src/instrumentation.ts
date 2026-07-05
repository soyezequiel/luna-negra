// Instrumentación de servidor (Next 16): se ejecuta una vez al arrancar cada
// instancia. Carga el init de Sentry según el runtime y delega la inicialización
// de servicios Node.js a `instrumentation.node.ts` (evita importar módulos de Node
// en el trazado de Edge Instrumentation).
import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";
import { notifyOperationalError } from "@/lib/discord";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    const { registerNode } = await import("./instrumentation.node");
    await registerNode();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura errores no manejados de route handlers, actions y server components.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  Sentry.captureRequestError(error, request, context);
  const digest =
    error && typeof error === "object" && "digest" in error
      ? String(error.digest)
      : undefined;
  await notifyOperationalError({
    source: `next-${context.routeType}`,
    error,
    fingerprint: digest ? `next:${digest}` : undefined,
    context: {
      method: request.method,
      path: request.path.split("?", 1)[0],
      routePath: context.routePath,
      routerKind: context.routerKind,
      ...(digest ? { digest } : {}),
    },
  });
};
