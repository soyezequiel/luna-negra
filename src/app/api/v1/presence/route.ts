import { verifyApiKey } from "@/lib/api-keys";
import { pubkeyFromNpub, npubOf } from "@/lib/nostr-social";
import { recordPresence } from "@/lib/social";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Heartbeat de presencia del juego (cada ~10s). Renueva la presencia del jugador
// en ESTE juego con TTL ~30s, así "offline" es automático al cerrar el juego.
// Auth: Authorization: Bearer <API_KEY> (ln_sk_…).
export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: Request) {
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);
  }

  const body = await req.json().catch(() => ({}));
  const pubkey = pubkeyFromNpub(String((body as { npub?: unknown })?.npub ?? ""));
  if (!pubkey) {
    return apiError("INVALID_NPUB", "Falta o es inválido `npub`", 400);
  }
  const rawStatus = (body as { status?: unknown })?.status;
  if (rawStatus !== "in-game" && rawStatus !== "online") {
    return apiError("INVALID_STATUS", "`status` debe ser \"in-game\" u \"online\"", 400);
  }
  const rawRoom = (body as { roomId?: unknown })?.roomId;
  const roomId = typeof rawRoom === "string" && rawRoom ? rawRoom.slice(0, 64) : null;

  // Bolsa libre opcional: el juego decide qué guarda (puntaje, vidas, equipo…).
  // Solo objetos planos; tope de 2KB para no abusar de la fila de presencia.
  const rawState = (body as { state?: unknown })?.state;
  const state =
    rawState && typeof rawState === "object" && !Array.isArray(rawState)
      ? (rawState as Record<string, unknown>)
      : null;
  if (state && JSON.stringify(state).length > 2048) {
    return apiError("STATE_TOO_LARGE", "`state` no puede superar 2KB", 400);
  }

  // Normalizamos el npub desde el pubkey decodificado (defensa contra formato raro).
  await recordPresence(providerId, npubOf(pubkey), rawStatus, roomId, state);
  return apiOk({ ok: true });
}
