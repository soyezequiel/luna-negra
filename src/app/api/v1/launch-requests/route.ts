import { verifyApiKey } from "@/lib/api-keys";
import { apiError, apiOk, corsPreflight } from "@/lib/api";
import {
  consumeGameLaunchRequest,
  recordGameLaunchListener,
} from "@/lib/game-launch-requests";
import { npubOf, pubkeyFromNpub } from "@/lib/nostr-social";

// Ordenes de entrada a sala pendientes para un juego abierto.
// Auth: Authorization: Bearer <API_KEY> (ln_sk_...).
export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError("INVALID_API_KEY", "API key invalida (Authorization: Bearer ln_sk_...)", 401);
  }

  const url = new URL(req.url);
  const pubkey = pubkeyFromNpub(url.searchParams.get("npub") ?? "");
  if (!pubkey) {
    return apiError("INVALID_NPUB", "Falta o es invalido `npub`", 400);
  }

  const npub = npubOf(pubkey);
  await recordGameLaunchListener({
    providerId,
    npub,
  });

  const request = await consumeGameLaunchRequest({
    providerId,
    npub,
  });

  return apiOk({ request });
}
