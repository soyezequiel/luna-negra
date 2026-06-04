// Instrumentación de cliente (Next 16): corre en el navegador antes de la
// hidratación. Inicializa Sentry para capturar errores del frontend.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

Sentry.init({
  // El DSN del cliente es público por diseño, pero Next exige el prefijo NEXT_PUBLIC_.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: (event) => scrubEvent(event),
});

// Breadcrumbs de navegación del App Router (contexto para los errores).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
