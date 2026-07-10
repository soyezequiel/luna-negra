import { prisma } from "@/lib/prisma";
import { verifyInvite, signInvite, type SessionPayload } from "@/lib/auth";

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type MintInviteResult =
  | { ok: true; token: string; roomId: string; host: boolean; slug: string }
  | { ok: false; code: string; message: string; status: number };

/**
 * Mintea un invite token de sala multijugador para un jugador que posee el juego.
 * `roomId === null` → crea una sala (host). Con `roomId` → se une a una existente.
 * Compartido por `POST /games/:id/rooms` (crear) y `.../rooms/:roomId/members` (unirse).
 */
export async function mintRoomInvite(
  session: SessionPayload,
  gameId: string,
  roomId: string | null,
): Promise<MintInviteResult> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.status !== "published") {
    return { ok: false, code: "GAME_NOT_FOUND", message: "Juego no encontrado", status: 404 };
  }

  let owns = game.priceSats === 0;
  if (!owns) {
    const p = await prisma.purchase.findUnique({
      where: { userId_gameId: { userId: session.sub, gameId } },
    });
    owns = p?.status === "paid";
  }
  if (!owns) {
    return { ok: false, code: "NOT_OWNED", message: "No tenés acceso a este juego", status: 403 };
  }

  const host = !roomId;
  let finalRoomId: string;
  // Identidad Nostr del host original: del creador al crear, o de la fila Room al unirse.
  let hostNpub: string | null;
  let hostPubkey: string | null;

  if (host) {
    // Crear: generamos un roomId único y persistimos al host original.
    finalRoomId = crypto.randomUUID().slice(0, 8);
    await prisma.room.create({
      data: {
        gameId,
        roomId: finalRoomId,
        hostNpub: session.npub,
        hostPubkey: session.pubkey,
      },
    });
    hostNpub = session.npub;
    hostPubkey = session.pubkey;
  } else {
    if (!ROOM_RE.test(roomId)) {
      return { ok: false, code: "INVALID_ROOM", message: "Sala inválida", status: 400 };
    }
    finalRoomId = roomId;
    // Unirse: resolvemos quién es el host real (null si la sala es externa/legacy).
    const room = await prisma.room.findUnique({
      where: { gameId_roomId: { gameId, roomId } },
    });
    hostNpub = room?.hostNpub ?? null;
    hostPubkey = room?.hostPubkey ?? null;
  }

  const token = await signInvite({
    npub: session.npub,
    pubkey: session.pubkey,
    gameId,
    slug: game.slug,
    roomId: finalRoomId,
    host,
    hostNpub,
    hostPubkey,
  });
  return { ok: true, token, roomId: finalRoomId, host, slug: game.slug };
}

// Núcleo de la presencia de salas multijugador, compartido por la ruta v1 y la
// vieja. TTL: 15s sin heartbeat = fuera de la sala.
const STALE_MS = 15_000;

export type PresenceMember = {
  clientId: string;
  npub: string;
  host: boolean;
  score: number;
  name: string | null;
  avatar: string | null;
};

export type PresenceResult =
  | {
      ok: true;
      members: PresenceMember[];
      missingPubkeys: string[];
      /** El host cerró el juego: la sala está cerrada y no readmite a nadie. */
      closed: boolean;
    }
  | { ok: false; code: string; message: string; status: number };

/**
 * Lee el roster fresco de la sala (purga vencidos) enriquecido con nombre/avatar
 * cacheados. `missingPubkeys` son los que aún no tienen perfil → el caller los
 * resuelve en background. Solo lectura/cleanup: no registra ni cierra nada.
 */
async function readRoster(
  roomId: string,
): Promise<{ members: PresenceMember[]; missingPubkeys: string[] }> {
  const cutoff = new Date(Date.now() - STALE_MS);
  await prisma.roomPresence.deleteMany({ where: { roomId, updatedAt: { lt: cutoff } } });
  const rows = await prisma.roomPresence.findMany({
    where: { roomId, updatedAt: { gte: cutoff } },
    select: { clientId: true, npub: true, host: true, score: true },
    orderBy: { createdAt: "asc" },
  });

  // Enriquecer con nombre/avatar cacheados (kind:0).
  const npubs = [...new Set(rows.map((m) => m.npub))];
  const users = npubs.length
    ? await prisma.user.findMany({
        where: { npub: { in: npubs } },
        select: { npub: true, pubkey: true, displayName: true, avatarUrl: true },
      })
    : [];
  const byNpub = new Map(users.map((u) => [u.npub, u]));
  const members: PresenceMember[] = rows.map((m) => ({
    ...m,
    name: byNpub.get(m.npub)?.displayName ?? null,
    avatar: byNpub.get(m.npub)?.avatarUrl ?? null,
  }));

  const missingPubkeys = users
    .filter((u) => !u.displayName || !u.avatarUrl)
    .map((u) => u.pubkey);

  return { members, missingPubkeys };
}

/**
 * Procesa un heartbeat de presencia: valida el token, upsert/borra la fila,
 * limpia vencidas y devuelve el roster enriquecido con nombre/avatar cacheados.
 * `missingPubkeys` son los que aún no tienen perfil → el caller los resuelve en
 * background (next/server `after`).
 *
 * `peek: true` → solo lectura del roster, sin registrar/borrar presencia ni
 * disparar el cierre de la sala. Lo usa la barra de amigos del host (que solo
 * tiene SU token de host) para mostrar "X en la sala" mientras espera: un POST
 * normal con `leave` y el token de host activaría el cierre automático
 * (`leaving && inv.host`) y echaría a los invitados antes de que entren.
 */
export async function resolvePresence(
  roomId: string,
  input: {
    inviteToken: unknown;
    clientId: unknown;
    score: unknown;
    leave: unknown;
    peek?: unknown;
  },
): Promise<PresenceResult> {
  // La identidad (npub/host) sale del token verificado, NO del cliente.
  const inv = await verifyInvite(
    typeof input.inviteToken === "string" ? input.inviteToken : "",
  );
  if (!inv || inv.roomId !== roomId) {
    return {
      ok: false,
      code: "INVALID_TOKEN",
      message: "Invitación inválida para esta sala",
      status: 401,
    };
  }

  // Fila de la sala: nos dice quién es el host y si ya está cerrada. (Las salas
  // externas/legacy sin fila Room no tienen cierre automático.)
  const room = await prisma.room.findUnique({
    where: { gameId_roomId: { gameId: inv.gameId, roomId } },
  });

  // Modo "peek": lectura pura, sin tocar el estado de la sala.
  if (input.peek === true) {
    if (room?.closedAt) {
      return { ok: true, members: [], missingPubkeys: [], closed: true };
    }
    return { ok: true, ...(await readRoster(roomId)), closed: false };
  }

  const clientId = String(input.clientId ?? "").slice(0, 32);
  if (!clientId) {
    return { ok: false, code: "MISSING_CLIENT_ID", message: "Falta clientId", status: 400 };
  }
  const leaving = input.leave === true;
  const score = Math.max(0, Math.min(1_000_000, Math.floor(Number(input.score) || 0)));

  // Sala ya cerrada por el host: no readmitir. Limpiar mi presencia y avisar.
  if (room?.closedAt) {
    await prisma.roomPresence
      .delete({ where: { roomId_clientId: { roomId, clientId } } })
      .catch(() => {});
    return { ok: true, members: [], missingPubkeys: [], closed: true };
  }

  if (leaving) {
    await prisma.roomPresence
      .delete({ where: { roomId_clientId: { roomId, clientId } } })
      .catch(() => {});
  } else {
    await prisma.roomPresence.upsert({
      where: { roomId_clientId: { roomId, clientId } },
      create: { roomId, clientId, npub: inv.npub, host: inv.host, score },
      update: { npub: inv.npub, host: inv.host, score },
    });
    // Sellar la llegada del host al primer latido (guard del cierre por ausencia).
    if (inv.host && room && !room.hostSeenAt) {
      await prisma.room
        .update({ where: { id: room.id }, data: { hostSeenAt: new Date() } })
        .catch(() => {});
    }
  }

  const { members, missingPubkeys } = await readRoster(roomId);

  // ¿El host cerró el juego? Dos señales: leave explícito del host, o el host ya
  // estuvo presente (hostSeenAt) pero su presencia venció y no queda ninguno en
  // el roster fresco. En ambos casos cerramos la sala para siempre y echamos a
  // todos: los invitados reciben closed:true en su próximo latido.
  const hostPresent = members.some((m) => m.host);
  const hostClosed =
    !!room &&
    ((leaving && inv.host) || (!!room.hostSeenAt && !hostPresent));
  if (hostClosed && room) {
    await prisma.room
      .update({ where: { id: room.id }, data: { closedAt: new Date() } })
      .catch(() => {});
    await prisma.roomPresence.deleteMany({ where: { roomId } });
    return { ok: true, members: [], missingPubkeys: [], closed: true };
  }

  return { ok: true, members, missingPubkeys, closed: false };
}
