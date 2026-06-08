import { prisma } from "@/lib/prisma";
import {
  fetchContacts,
  fetchProfiles,
  npubOf,
  profileName,
} from "@/lib/nostr-social";

// Capa social que consume el game server (spec luna-negra-social-spec.md):
// amigos (NIP-02), presencia por proveedor y su enriquecimiento de perfil.
// Las rutas v1 quedan finas; acá vive la lógica compartida.

// TTL de la presencia por-juego. El game server late cada ~10s; a los 30s sin
// latido el amigo cae a "offline" (lo decide getPresence al filtrar por expiresAt).
export const PRESENCE_TTL_MS = 30_000;

// Tope de contactos a enriquecer/consultar: evita explotar el query a relays y la
// respuesta para usuarios con listas de seguidos enormes.
const MAX_FRIENDS = 150;

export type Presence = "in-game" | "online" | "offline";

export type FriendEntry = {
  npub: string;
  displayName: string | null;
  avatarUrl: string | null;
  presence: Presence;
  roomId: string | null;
  lastSeenMs: number | null;
};

/** Registra/renueva la presencia de un jugador en el juego del proveedor. */
export async function recordPresence(
  providerId: string,
  npub: string,
  status: "in-game" | "online",
  roomId: string | null,
): Promise<void> {
  const expiresAt = new Date(Date.now() + PRESENCE_TTL_MS);
  await prisma.gamePresence.upsert({
    where: { providerId_npub: { providerId, npub } },
    create: { providerId, npub, status, roomId, expiresAt },
    update: { status, roomId, expiresAt },
  });
  // Limpieza oportunista de presencias vencidas (mismo patrón TTL que rooms.ts).
  await prisma.gamePresence
    .deleteMany({ where: { providerId, expiresAt: { lt: new Date() } } })
    .catch(() => {});
}

/** Presencia vigente de un set de npubs en el juego del proveedor. */
async function getPresence(
  providerId: string,
  npubs: string[],
): Promise<Map<string, { status: Presence; roomId: string | null; lastSeenMs: number }>> {
  if (npubs.length === 0) return new Map();
  const rows = await prisma.gamePresence.findMany({
    where: { providerId, npub: { in: npubs }, expiresAt: { gt: new Date() } },
    select: { npub: true, status: true, roomId: true, updatedAt: true },
  });
  return new Map(
    rows.map((r) => [
      r.npub,
      {
        status: r.status === "in-game" ? "in-game" : "online",
        roomId: r.roomId,
        lastSeenMs: r.updatedAt.getTime(),
      },
    ]),
  );
}

const RANK: Record<Presence, number> = { "in-game": 0, online: 1, offline: 2 };

/**
 * Lista de amigos (contactos NIP-02) de `pubkey`, enriquecida con nombre/avatar
 * (caché en User + fallback a relays) y, si `withPresence`, con su presencia en
 * el juego del proveedor. Ordenada in-game → online → offline.
 */
export async function listFriends(
  pubkey: string,
  providerId: string,
  withPresence: boolean,
): Promise<FriendEntry[]> {
  const contacts = (await fetchContacts(pubkey)).slice(0, MAX_FRIENDS);
  if (contacts.length === 0) return [];

  // Nombre/avatar: primero la caché local (kind:0), luego un solo query batched a
  // relays para los que falten (acotado por MAX_WAIT en nostr-social).
  const cached = await prisma.user.findMany({
    where: { pubkey: { in: contacts } },
    select: { pubkey: true, displayName: true, avatarUrl: true },
  });
  const byPubkey = new Map(cached.map((u) => [u.pubkey, u]));
  const missing = contacts.filter((pk) => {
    const u = byPubkey.get(pk);
    return !u || !u.displayName || !u.avatarUrl;
  });
  const fetched = missing.length ? await fetchProfiles(missing) : {};

  const npubs = contacts.map(npubOf);
  const presence = withPresence
    ? await getPresence(providerId, npubs)
    : new Map();

  const friends = contacts.map((pk, i): FriendEntry => {
    const u = byPubkey.get(pk);
    const p = fetched[pk];
    const pres = presence.get(npubs[i]);
    return {
      npub: npubs[i],
      displayName: u?.displayName ?? (p ? profileName(p, "") || null : null),
      avatarUrl: u?.avatarUrl ?? p?.picture ?? null,
      presence: pres?.status ?? "offline",
      roomId: pres?.roomId ?? null,
      lastSeenMs: pres?.lastSeenMs ?? null,
    };
  });

  friends.sort((a, b) => RANK[a.presence] - RANK[b.presence]);
  return friends;
}
