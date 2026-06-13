import { getSession } from "@/lib/auth";
import { consumePendingInvites } from "@/lib/game-invites";

// Stream SSE del buzón de invitaciones a sala (first-party, cookie de sesión).
// El servidor mantiene la conexión abierta y revisa el buzón cada POLL_MS,
// empujando cada invitación nueva apenas aparece (~1-2s vs. los 15s del polling
// del cliente). El NotificationsProvider lo consume con EventSource, que
// reconecta solo cuando la función serverless llega a su límite de duración.
export const runtime = "nodejs"; // Prisma necesita Node, no Edge.
export const dynamic = "force-dynamic";
// Vercel recorta esto según el plan; cerramos antes (MAX_STREAM_MS) para que el
// cliente reconecte de forma limpia en lugar de que la plataforma corte en seco.
export const maxDuration = 300;

const POLL_MS = 2_000; // cada cuánto revisa el buzón en el servidor
const HEARTBEAT_MS = 15_000; // keep-alive para proxies/balanceadores
const MAX_STREAM_MS = 240_000; // cierre proactivo antes del maxDuration

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response("No autenticado", { status: 401 });
  }

  const npub = session.npub;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        clearTimeout(lifetimeTimer);
        req.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      }

      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          cleanup();
        }
      };

      const poll = async () => {
        try {
          const invites = await consumePendingInvites(npub);
          for (const inv of invites) {
            send(`data: ${JSON.stringify(inv)}\n\n`);
          }
        } catch {
          /* best-effort: reintenta en el próximo tick */
        }
      };

      const pollTimer = setInterval(() => void poll(), POLL_MS);
      // Comentarios SSE (líneas que empiezan con `:`): EventSource los ignora,
      // solo mantienen viva la conexión.
      const heartbeatTimer = setInterval(() => send(`: ka\n\n`), HEARTBEAT_MS);
      const lifetimeTimer = setTimeout(cleanup, MAX_STREAM_MS);

      req.signal.addEventListener("abort", cleanup);

      // Saludo inicial + lectura inmediata (entrega lo pendiente sin esperar al
      // primer tick).
      send(`: ok\n\n`);
      void poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Evita el buffering de proxies (Nginx/Vercel) que rompería el stream.
      "X-Accel-Buffering": "no",
    },
  });
}
