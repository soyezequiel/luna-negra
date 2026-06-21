import { verifyApiKey } from "@/lib/api-keys";
import { pubkeyFromNpub, profileName, searchProfiles } from "@/lib/nostr-social";
import { listFriends, type FriendEntry } from "@/lib/social";
import { recordIntegration } from "@/lib/integration-telemetry";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Lista de amigos (contactos NIP-02) del jugador, con su presencia en ESTE juego.
// Auth: Authorization: Bearer <API_KEY> (ln_sk_…).
// Query: npub, presence=true, q=<texto> (buscar para invitar).
//
// Orden: jugando ahora → jugó alguna vez → tiene cuenta en Luna Negra → resto.
// Con `q`, primero filtra los follows; si no hay match, busca en TODO Nostr
// (NIP-50 / NIP-05 / npub) para que el juego pueda invitar a alguien que el
// jugador todavía no sigue. Los resultados externos llevan `isFollow: false`.
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
  const q = url.searchParams.get("q")?.trim() ?? "";

  const friends = await listFriends(pubkey, providerId, withPresence);
  void recordIntegration("social", { providerId });

  if (!q) return apiOk({ friends });

  // Filtro local sobre los follows (nombre o npub).
  const needle = q.toLowerCase();
  const local = friends.filter(
    (f) =>
      f.npub.toLowerCase().includes(needle) ||
      (f.displayName?.toLowerCase().includes(needle) ?? false),
  );
  if (local.length > 0) return apiOk({ friends: local, query: q });

  // Sin match en follows: buscar en todo Nostr.
  const followNpubs = new Set(friends.map((f) => f.npub));
  let global: FriendEntry[] = [];
  try {
    const results = await searchProfiles(q, 10);
    global = results
      .filter((r) => !followNpubs.has(r.npub))
      .map((r) => ({
        npub: r.npub,
        displayName: r.profile ? profileName(r.profile, "") || null : null,
        avatarUrl: r.profile?.picture ?? null,
        presence: "offline",
        roomId: null,
        state: null,
        lastSeenMs: null,
        isMember: false,
        lastPlayedAt: null,
        isFollow: false,
      }));
  } catch {
    /* búsqueda global best-effort: si los relays fallan, devolvemos vacío */
  }
  return apiOk({ friends: global, query: q });
}
