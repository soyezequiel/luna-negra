import { verifyApiKey } from "@/lib/api-keys";
import { pubkeyFromNpub } from "@/lib/nostr-social";
import { listFriends } from "@/lib/social";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Lista de amigos (contactos NIP-02) del jugador, con su presencia en ESTE juego.
// Auth: Authorization: Bearer <API_KEY> (ln_sk_…). Query: npub, presence=true.
export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  const providerId = await verifyApiKey(req);
  if (!providerId) {
    return apiError("INVALID_API_KEY", "API key inválida (Authorization: Bearer ln_sk_…)", 401);
  }

  const url = new URL(req.url);
  const npub = url.searchParams.get("npub")?.trim() ?? "";
  const pubkey = pubkeyFromNpub(npub);
  if (!pubkey) {
    return apiError("INVALID_NPUB", "Falta o es inválido el query param `npub`", 400);
  }
  const withPresence = url.searchParams.get("presence") === "true";

  const friends = await listFriends(pubkey, providerId, withPresence);
  return apiOk({ friends });
}
