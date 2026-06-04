// Init de Sentry para el runtime Node.js (API routes, server components).
// Se importa desde src/instrumentation.ts según NEXT_RUNTIME.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Sin DSN, el SDK queda inerte (no envía nada) → seguro en dev y en builds sin configurar.
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // Errores siempre; el tracing (performance) va apagado por defecto para no gastar
  // cuota. Subir SENTRY_TRACES_SAMPLE_RATE (0–1) si se quiere medir latencias.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  // No mandar IP, cookies ni headers de usuario.
  sendDefaultPii: false,
  beforeSend: (event) => scrubEvent(event),
  beforeSendTransaction: (event) => scrubEvent(event),
});
