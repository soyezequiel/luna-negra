import { prisma } from "@/lib/prisma";
import { verifyInvite } from "@/lib/auth";

// Estado compartido de una sala, para juegos SIN backend propio: Luna Negra
// hostea el "tablero común" (bolsa key/value, estilo SetLobbyData de Steam) más
// el estado por jugador (estilo SetLobbyMemberData). La plataforma NO interpreta
// las claves: su significado lo decide el juego.
//
// Auth = jugador (Bearer invite token de la sala), no API key: el cliente del
// juego escribe sin servidor propio, reusando el patrón de `rooms/:id/presence`.

// TTL corto, como la presencia: cada POST (escritura compartida o heartbeat del
// propio jugador) renueva la expiración. Si nadie escribe por TTL, la sala se
// considera abandonada y se purga.
const ROOM_STATE_TTL_MS = 60_000;
// Topes de tamaño de cada bolsa (JSON serializado), para no abusar de la fila.
const SHARED_MAX_BYTES = 8192;
const MEMBER_MAX_BYTES = 2048;

export type RoomStateMember = {
  npub: string;
  name: string | null;
  avatar: string | null;
  state: Record<string, unknown>;
};

export type RoomStateView = {
  data: Record<string, unknown>;
  version: number;
  members: RoomStateMember[];
};

export type RoomStateWrite = {
  /** Mezcla en la bolsa compartida (last-write-wins por clave). */
  set?: unknown;
  /** Reemplaza la bolsa del propio jugador (su slice en `members[]`). */
  self?: unknown;
  /** Concurrencia optimista opcional para `set`: debe coincidir con `version`. */
  version?: unknown;
};

export type RoomStateResult =
  | { ok: true; view: RoomStateView }
  | { ok: false; code: string; message: string; status: number };

type AuthResult =
  | { ok: true; npub: string; gameId: string }
  | { ok: false; code: string; message: string; status: number };

/** Valida el invite token y que sea de ESTA sala. La identidad sale del token. */
export async function authRoomMember(
  token: string | null,
  roomId: string,
): Promise<AuthResult> {
  const inv = await verifyInvite(typeof token === "string" ? token : "");
  if (!inv || inv.roomId !== roomId) {
    return { ok: false, code: "INVALID_TOKEN", message: "Invitación inválida para esta sala", status: 401 };
  }
  return { ok: true, npub: inv.npub, gameId: inv.gameId };
}

function parseBag(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Bolsa válida (objeto plano) o `null` si el valor no sirve. */
function asBag(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Borra el estado compartido y los miembros vencidos de la sala. */
async function pruneExpired(roomId: string, now: Date): Promise<void> {
  await prisma.roomMemberState.deleteMany({ where: { roomId, expiresAt: { lt: now } } });
  await prisma.roomState.deleteMany({ where: { roomId, expiresAt: { lt: now } } });
}

/** Vista actual de la sala: bolsa compartida + versión + roster con su estado. */
export async function readRoomState(roomId: string, now = new Date()): Promise<RoomStateView> {
  await pruneExpired(roomId, now);

  const shared = await prisma.roomState.findUnique({ where: { roomId } });
  const rows = await prisma.roomMemberState.findMany({
    where: { roomId, expiresAt: { gte: now } },
    orderBy: { createdAt: "asc" },
    select: { npub: true, stateJson: true },
  });

  // Enriquecer con nombre/avatar cacheados (kind:0), como la presencia de sala.
  const npubs = [...new Set(rows.map((r) => r.npub))];
  const users = npubs.length
    ? await prisma.user.findMany({
        where: { npub: { in: npubs } },
        select: { npub: true, displayName: true, avatarUrl: true },
      })
    : [];
  const byNpub = new Map(users.map((u) => [u.npub, u]));

  const members: RoomStateMember[] = rows.map((r) => ({
    npub: r.npub,
    name: byNpub.get(r.npub)?.displayName ?? null,
    avatar: byNpub.get(r.npub)?.avatarUrl ?? null,
    state: parseBag(r.stateJson),
  }));

  return {
    data: parseBag(shared?.dataJson),
    version: shared?.version ?? 0,
    members,
  };
}

/**
 * Escribe el estado de la sala (y/o el del jugador). Cada POST renueva el TTL de
 * la sala y registra al jugador en el roster (actúa de heartbeat). Devuelve la
 * vista fresca para que el cliente no necesite un GET extra.
 */
export async function writeRoomState(
  roomId: string,
  npub: string,
  body: RoomStateWrite,
  now = new Date(),
): Promise<RoomStateResult> {
  const expiresAt = new Date(now.getTime() + ROOM_STATE_TTL_MS);

  // Validar bolsas.
  let setBag: Record<string, unknown> | null = null;
  if (body.set !== undefined) {
    setBag = asBag(body.set);
    if (!setBag) {
      return { ok: false, code: "INVALID_SET", message: "`set` debe ser un objeto plano", status: 400 };
    }
  }
  let selfBag: Record<string, unknown> | null = null;
  if (body.self !== undefined) {
    selfBag = asBag(body.self);
    if (!selfBag) {
      return { ok: false, code: "INVALID_SELF", message: "`self` debe ser un objeto plano", status: 400 };
    }
    if (JSON.stringify(selfBag).length > MEMBER_MAX_BYTES) {
      return { ok: false, code: "STATE_TOO_LARGE", message: "`self` no puede superar 2KB", status: 400 };
    }
  }

  await pruneExpired(roomId, now);

  // Escritura compartida (last-write-wins por clave; CAS opcional vía `version`).
  if (setBag) {
    const existing = await prisma.roomState.findUnique({ where: { roomId } });
    const currentVersion = existing?.version ?? 0;
    if (body.version !== undefined) {
      const expected = Number(body.version);
      if (!Number.isInteger(expected) || expected !== currentVersion) {
        return {
          ok: false,
          code: "VERSION_CONFLICT",
          message: `La sala cambió (versión actual ${currentVersion})`,
          status: 409,
        };
      }
    }
    const merged = { ...parseBag(existing?.dataJson), ...setBag };
    const mergedJson = JSON.stringify(merged);
    if (mergedJson.length > SHARED_MAX_BYTES) {
      return { ok: false, code: "STATE_TOO_LARGE", message: "El estado compartido no puede superar 8KB", status: 400 };
    }
    await prisma.roomState.upsert({
      where: { roomId },
      create: { roomId, dataJson: mergedJson, version: currentVersion + 1, expiresAt },
      update: { dataJson: mergedJson, version: currentVersion + 1, expiresAt },
    });
  } else {
    // Sin escritura compartida: si la sala ya existe, solo renovamos su TTL para
    // que no se purgue mientras haya jugadores latiendo. (No creamos fila vacía.)
    await prisma.roomState.updateMany({ where: { roomId }, data: { expiresAt } });
  }

  // El jugador siempre entra/permanece en el roster (heartbeat); su bolsa se
  // reemplaza solo si mandó `self`.
  await prisma.roomMemberState.upsert({
    where: { roomId_npub: { roomId, npub } },
    create: { roomId, npub, stateJson: selfBag ? JSON.stringify(selfBag) : "{}", expiresAt },
    update: { ...(selfBag ? { stateJson: JSON.stringify(selfBag) } : {}), expiresAt },
  });

  return { ok: true, view: await readRoomState(roomId, now) };
}
