import { prisma } from "@/lib/prisma";
import {
  clampContacts,
  fetchContacts,
  fetchProfiles,
  npubOf,
  profileName,
} from "@/lib/nostr-social";
import { compareFriends } from "@/lib/friend-sort";

// Capa social que consume el game server (spec luna-negra-social-spec.md):
// amigos (NIP-02), presencia por proveedor y su enriquecimiento de perfil.
// Las rutas v1 quedan finas; acá vive la lógica compartida.


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
  /** Bolsa libre que reporta el juego (puntaje, vidas, equipo…), o null. */
  state?: Record<string, unknown> | null;
  lastSeenMs: number | null;
  /** Tiene cuenta en Luna Negra. */
  isMember: boolean;
  /** Última vez que jugó en Luna Negra (epoch ms) o null si nunca. */
  lastPlayedAt: number | null;
  /** false = resultado de búsqueda global (no está en tus follows). */
  isFollow?: boolean;
};

/** Bolsa de estado libre desde su forma serializada (objeto plano, o null). */
function parseState(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const MAX_STATE_LABEL = 40;

/**
 * Mini-contrato del `stateJson` que el juego reporta en el heartbeat (§3, bolsa
 * libre): claves opcionales `label` (texto del juego, prioritaria), `score` y
 * `level` (números); el resto de la bolsa se ignora acá. Devuelve un texto
 * corto listo para mostrar ("nivel 7", "12.400 pts") o null si no hay nada
 * reconocible. El juego es un tercero — se sanea longitud, no se confía en que
 * mande algo corto o inocuo.
 */
export function deriveStateLabel(
  state: Record<string, unknown> | null,
): string | null {
  if (!state) return null;
  if (typeof state.label === "string" && state.label.trim()) {
    return state.label.trim().slice(0, MAX_STATE_LABEL);
  }
  if (typeof state.score === "number" && Number.isFinite(state.score)) {
    return `${state.score.toLocaleString("es-AR")} pts`;
  }
  if (typeof state.level === "number" && Number.isFinite(state.level)) {
    return `nivel ${Math.floor(state.level)}`;
  }
  return null;
}

/** Presencia vigente de un set de npubs en el juego del proveedor. */
async function getPresence(
  providerId: string,
  npubs: string[],
): Promise<Map<string, { status: Presence; roomId: string | null; state: Record<string, unknown> | null; lastSeenMs: number }>> {
  if (npubs.length === 0) return new Map();
  const rows = await prisma.gamePresence.findMany({
    where: { providerId, npub: { in: npubs }, expiresAt: { gt: new Date() } },
    select: { npub: true, status: true, roomId: true, stateJson: true, updatedAt: true },
  });
  return new Map(
    rows.map((r) => [
      r.npub,
      {
        status: r.status === "in-game" ? "in-game" : "online",
        roomId: r.roomId,
        state: parseState(r.stateJson),
        lastSeenMs: r.updatedAt.getTime(),
      },
    ]),
  );
}

/**
 * Presencia vigente del PROPIO jugador en cualquier juego del catálogo (keyed por
 * npub). La tienda la consulta vía `GET /api/me/playing` para gobernar su estado
 * NIP-38 "Jugando X": mientras el juego siga reportando presencia por la API, la
 * tienda renueva el estado; cuando deja de reportar (TTL vencido), lo limpia. El
 * juego nunca toca Nostr — solo reporta por la API y Luna Negra deriva lo social.
 */
export async function getOwnPresence(
  npub: string,
): Promise<{
  status: Presence;
  roomId: string | null;
  stateLabel: string | null;
} | null> {
  const row = await prisma.gamePresence.findFirst({
    where: { npub, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" },
    select: { status: true, roomId: true, stateJson: true },
  });
  if (!row) return null;
  return {
    status: row.status === "in-game" ? "in-game" : "online",
    roomId: row.roomId,
    stateLabel: deriveStateLabel(parseState(row.stateJson)),
  };
}

/**
 * De un set de pubkeys, cuáles el servidor detecta jugando AHORA en cualquier
 * juego del catálogo (presencia `GamePresence` vigente; su reporte REST 1.0 fue
 * retirado, así que hoy sólo refleja datos legados). A diferencia del estado
 * NIP-38 —que sólo publica la
 * pestaña de la tienda mientras está abierta y expira al cerrarla—, esta señal
 * sobrevive con la tienda cerrada, así que sirve para marcar "conectado" a quien
 * está jugando aunque no tenga la web abierta. `GamePresence` se llavea por npub;
 * mapeamos ida y vuelta para responder en pubkeys.
 */
export async function playingPubkeys(pubkeys: string[]): Promise<string[]> {
  if (pubkeys.length === 0) return [];
  const npubToPk = new Map(pubkeys.map((pk) => [npubOf(pk), pk]));
  const rows = await prisma.gamePresence.findMany({
    where: { npub: { in: [...npubToPk.keys()] }, expiresAt: { gt: new Date() } },
    select: { npub: true },
    distinct: ["npub"],
  });
  return rows
    .map((r) => npubToPk.get(r.npub))
    .filter((pk): pk is string => Boolean(pk));
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
  const contacts = clampContacts(await fetchContacts(pubkey), MAX_FRIENDS);
  if (contacts.length === 0) return [];

  // Nombre/avatar: primero la caché local (kind:0), luego un solo query batched a
  // relays para los que falten (acotado por MAX_WAIT en nostr-social).
  const cached = await prisma.user.findMany({
    where: { pubkey: { in: contacts } },
    select: {
      pubkey: true,
      displayName: true,
      avatarUrl: true,
      lastPlayedAt: true,
    },
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
      state: pres?.state ?? null,
      lastSeenMs: pres?.lastSeenMs ?? null,
      isMember: byPubkey.has(pk),
      lastPlayedAt: u?.lastPlayedAt?.getTime() ?? null,
    };
  });

  sortFriendEntries(friends);
  return friends;
}

/**
 * Orden de la lista que reciben los juegos: jugando ahora → jugó alguna vez →
 * miembro → resto. "Jugando ahora" combina la presencia en este juego
 * (in-game/online) con el orden compartido por tiers.
 */
export function sortFriendEntries(friends: FriendEntry[]): void {
  friends.sort((a, b) => {
    // La presencia en ESTE juego es la señal más fuerte de "jugando ahora".
    if (RANK[a.presence] !== RANK[b.presence]) {
      return RANK[a.presence] - RANK[b.presence];
    }
    return compareFriends(
      {
        name: a.displayName ?? a.npub,
        playingNow: a.presence !== "offline",
        lastPlayedAt: a.lastPlayedAt,
        isMember: a.isMember,
      },
      {
        name: b.displayName ?? b.npub,
        playingNow: b.presence !== "offline",
        lastPlayedAt: b.lastPlayedAt,
        isMember: b.isMember,
      },
    );
  });
}
