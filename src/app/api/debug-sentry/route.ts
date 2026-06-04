// TEMPORAL — verificación de Sentry. Borrar después de confirmar que reporta.
//   GET /api/debug-sentry          → captura explícita + flush, devuelve eventId
//   GET /api/debug-sentry?throw=1  → lanza un error (prueba el hook onRequestError)
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export async function GET(req: Request) {
  const shouldThrow = new URL(req.url).searchParams.get("throw") === "1";

  if (shouldThrow) {
    // Error no manejado → Next llama onRequestError → Sentry lo captura.
    throw new Error("Luna Negra · prueba de Sentry (throw)");
  }

  // Captura explícita (como en los flujos de dinero) + flush, necesario en
  // serverless para que el evento se envíe antes de que la función se congele.
  const eventId = Sentry.captureException(
    new Error("Luna Negra · prueba de Sentry (captureException)"),
    { level: "error", tags: { flow: "debug" } },
  );
  await Sentry.flush(2000);

  return NextResponse.json({
    ok: true,
    sent: !!process.env.SENTRY_DSN,
    eventId,
    hint: process.env.SENTRY_DSN
      ? "Revisá el dashboard de Sentry (Issues) en unos segundos."
      : "SENTRY_DSN no está seteado: Sentry está inerte, no se envió nada.",
  });
}
