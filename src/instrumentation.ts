// Instrumentación de servidor (Next 16): se ejecuta una vez al arrancar cada
// instancia. Carga el init de Sentry según el runtime.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura errores no manejados de route handlers y server components.
export const onRequestError = Sentry.captureRequestError;
