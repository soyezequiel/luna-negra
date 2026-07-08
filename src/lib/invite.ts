/**
 * Invitaciones a sala multijugador transportadas por DM (NIP-04).
 *
 * El DM lleva texto corto + un link de sala de Luna Negra. Dentro de Luna Negra
 * ese link se detecta y se renderiza como un botón "Unirse"; en otros clientes
 * Nostr se ve como un link normal. Emisor (panel), chat y notificaciones
 * comparten este mismo formato/parseo.
 */

export type Invite = { slug: string; roomId: string };

// Mismo charset de roomId que ROOM_RE en src/lib/rooms.ts; slug en minúsculas.
const INVITE_RE =
  /\/game\/([a-z0-9-]+)\?(?:[^ \n]*&)?room=([A-Za-z0-9_-]{1,64})/i;

/** Texto del DM de invitación: una línea de contexto + el link clickeable. */
export function buildInviteMessage({
  slug,
  roomId,
  title,
  origin,
}: {
  slug: string;
  roomId: string;
  title: string;
  origin: string;
}): string {
  return `Te invito a jugar ${title} en Luna Negra 🎮\n${origin}${inviteHref({ slug, roomId })}`;
}

/**
 * Extrae una invitación de sala de un texto arbitrario, independiente del host
 * (matchea por path+query, así funciona en dev y prod). Devuelve null si no hay.
 */
export function parseInvite(text: string): Invite | null {
  const m = INVITE_RE.exec(text);
  if (!m) return null;
  return { slug: m[1], roomId: m[2] };
}

// "Luna Room Link": enlace a una sala HOSTEADA POR EL JUEGO, con el dominio del
// juego y el param `lnRoom` (ver docs/luna-room-link.md). A diferencia de
// `parseInvite`, el link NO lleva el slug de Luna (apunta directo al juego), así
// que devolvemos la URL cruda: entrar = abrir esa URL (el juego resuelve la
// identidad por cold-open contra /launch/<slug>).
export type RoomLink = { url: string; roomId: string };

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const LN_ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Detecta un enlace de sala de juego (`?lnRoom=…`) dentro de un texto arbitrario.
 * Parsea cada URL del texto y devuelve la primera con un `lnRoom` válido, o null.
 */
export function parseRoomLink(text: string): RoomLink | null {
  const matches = text.match(URL_RE);
  if (!matches) return null;
  for (const raw of matches) {
    try {
      const u = new URL(raw);
      const roomId = u.searchParams.get("lnRoom");
      if (roomId && LN_ROOM_RE.test(roomId)) return { url: raw, roomId };
    } catch {
      /* no es una URL válida → seguir */
    }
  }
  return null;
}

/** Extrae el título del juego del texto de invitación (ver buildInviteMessage). */
export function parseInviteTitle(text: string): string | null {
  const m = /Te invito a jugar (.+?) en Luna Negra/i.exec(text);
  return m ? m[1].trim() : null;
}

/** Path relativo para los <Link> internos de la app. */
export function inviteHref({ slug, roomId }: Invite): string {
  return `/game/${slug}?room=${encodeURIComponent(roomId)}`;
}

/**
 * Id del último mensaje RECIBIDO que es una invitación válida (invitación a sala
 * NIP-04 en el texto, o reto NIP-17 con `gameUrl`), sobre un hilo ordenado
 * ascendente por fecha. Solo esa —la más nueva del interlocutor— debe ofrecer
 * "entrar"; las anteriores quedan superadas. Devuelve null si no hay ninguna.
 */
export function latestJoinableInviteId(
  messages: { id: string; fromMe: boolean; text: string; gameUrl?: string }[],
): string | null {
  let id: string | null = null;
  for (const m of messages) {
    if (!m.fromMe && (parseInvite(m.text) || parseRoomLink(m.text) || m.gameUrl))
      id = m.id;
  }
  return id;
}

// --- Sala activa (la que el host creó y tiene abierta) ---
// Se guarda en localStorage para que otras páginas (p. ej. /friends) puedan
// invitar a esa sala. Expira igual que la presencia NIP-38 (1h).

export type ActiveRoom = {
  slug: string;
  roomId: string;
  title: string;
  /** URL del juego (para poder abrirlo después, no solo al crear la sala). */
  gameUrl?: string;
  /** Invite token del host: abre el juego más tarde y consulta la presencia. */
  hostToken?: string;
};

const ACTIVE_ROOM_KEY = "ln_active_room";
const ACTIVE_ROOM_TTL_MS = 3_600_000; // 1h

export function setActiveRoom(room: ActiveRoom): void {
  try {
    localStorage.setItem(
      ACTIVE_ROOM_KEY,
      JSON.stringify({ ...room, at: Date.now() }),
    );
  } catch {
    /* sin localStorage: no pasa nada */
  }
}

export function getActiveRoom(): ActiveRoom | null {
  try {
    const raw = localStorage.getItem(ACTIVE_ROOM_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as ActiveRoom & { at?: number };
    if (!d.slug || !d.roomId || typeof d.at !== "number") return null;
    if (Date.now() - d.at > ACTIVE_ROOM_TTL_MS) {
      clearActiveRoom();
      return null;
    }
    return {
      slug: d.slug,
      roomId: d.roomId,
      title: d.title,
      gameUrl: d.gameUrl,
      hostToken: d.hostToken,
    };
  } catch {
    return null;
  }
}

export function clearActiveRoom(): void {
  try {
    localStorage.removeItem(ACTIVE_ROOM_KEY);
  } catch {
    /* no-op */
  }
  emitActiveRoomChange();
}

// --- Vigilancia de la pestaña del juego ---
// El juego se abre en una pestaña aparte. Vigilamos esa referencia: cuando el
// usuario la cierra, limpiamos la sala activa (banner local) e invocamos
// `onClose` (p. ej. para limpiar la presencia NIP-38) así dejamos de mostrar
// que tiene el juego abierto. El timer es a nivel de módulo para sobrevivir a la
// navegación SPA dentro de la pestaña de la tienda.

const ACTIVE_ROOM_EVENT = "ln:active-room-change";
let watchTimer: ReturnType<typeof setInterval> | null = null;

function emitActiveRoomChange(): void {
  try {
    window.dispatchEvent(new Event(ACTIVE_ROOM_EVENT));
  } catch {
    /* SSR / sin window: no-op */
  }
}

export function watchGameWindow(
  win: Window | null,
  onClose?: () => void,
): void {
  if (!win) return;
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = setInterval(() => {
    if (!win.closed) return;
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null;
    clearActiveRoom();
    onClose?.();
  }, 2000);
}

/** Suscribe a cambios de la sala activa (cierre de pestaña, dismiss). */
export function onActiveRoomChange(cb: () => void): () => void {
  window.addEventListener(ACTIVE_ROOM_EVENT, cb);
  return () => window.removeEventListener(ACTIVE_ROOM_EVENT, cb);
}

// --- Invitaciones recibidas (pendientes de aceptar) ---
// Cuando llega un DM de invitación, lo guardamos acá para que la barra de amigos
// pueda anclar al amigo que invitó arriba de todo con la opción de unirse. Se
// guarda una invitación por emisor (la última gana) y expira como la presencia.

export type PendingInvite = {
  /** Pubkey (hex) de quien invitó. */
  fromPubkey: string;
  /** Título del juego, para mostrar "te invitó a jugar X". */
  title: string;
  at: number;
  roomId: string;
  /** Sala hosteada por Luna: slug para `joinRoomAndPlay`. */
  slug?: string;
  /** Luna Room Link (sala hosteada por el juego): URL del dominio del juego.
   * Unirse = abrir esa URL (el juego resuelve identidad y sala). */
  url?: string;
};

const PENDING_INVITES_KEY = "ln_pending_invites";
const PENDING_INVITE_TTL_MS = 3_600_000; // 1h
const PENDING_INVITES_EVENT = "ln:pending-invites-change";

function emitPendingInvitesChange(): void {
  try {
    window.dispatchEvent(new Event(PENDING_INVITES_EVENT));
  } catch {
    /* SSR / sin window: no-op */
  }
}

/** Invitaciones pendientes vigentes (descarta las expiradas). */
export function getPendingInvites(): PendingInvite[] {
  try {
    const raw = localStorage.getItem(PENDING_INVITES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PendingInvite[];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (i) =>
        i &&
        typeof i.at === "number" &&
        Date.now() - i.at <= PENDING_INVITE_TTL_MS,
    );
  } catch {
    return [];
  }
}

function writePendingInvites(list: PendingInvite[]): void {
  try {
    localStorage.setItem(PENDING_INVITES_KEY, JSON.stringify(list));
  } catch {
    /* sin localStorage: no pasa nada */
  }
  emitPendingInvitesChange();
}

/** Registra (o reemplaza) la invitación pendiente de un emisor. */
export function addPendingInvite(invite: PendingInvite): void {
  const list = getPendingInvites().filter(
    (i) => i.fromPubkey !== invite.fromPubkey,
  );
  list.push(invite);
  writePendingInvites(list);
}

/** Quita la invitación pendiente de un emisor (al unirse o descartar). */
export function removePendingInvite(fromPubkey: string): void {
  writePendingInvites(
    getPendingInvites().filter((i) => i.fromPubkey !== fromPubkey),
  );
}

/** Suscribe a cambios en las invitaciones pendientes. */
export function onPendingInvitesChange(cb: () => void): () => void {
  window.addEventListener(PENDING_INVITES_EVENT, cb);
  return () => window.removeEventListener(PENDING_INVITES_EVENT, cb);
}

// --- DMs/invitaciones ya notificadas (dedup entre recargas) ---
// La sub de DMs mira una ventana hacia atrás para pescar invitaciones recibidas
// con Luna Negra cerrada. Sin esto, cada recarga dentro de esa ventana volvería a
// disparar el toast de la misma invitación —incluso una ya descartada—. Guardamos
// los ids de evento ya mostrados (con TTL y tope) para avisar cada uno una sola vez.

const SURFACED_KEY = "ln_surfaced_dm_ids";
const SURFACED_TTL_MS = 3_600_000; // 1h (igual que la vigencia de las invitaciones)
const SURFACED_CAP = 300;

type SurfacedId = { id: string; at: number };

function readSurfaced(): SurfacedId[] {
  try {
    const raw = localStorage.getItem(SURFACED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SurfacedId[];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.at === "number" &&
        Date.now() - e.at <= SURFACED_TTL_MS,
    );
  } catch {
    return [];
  }
}

/** ¿Ya mostramos (toast) este evento en esta u otra carga reciente? */
export function wasNotified(id: string): boolean {
  return readSurfaced().some((e) => e.id === id);
}

/** Marca un evento como ya notificado (persistente, con TTL). */
export function markNotified(id: string): void {
  const list = readSurfaced().filter((e) => e.id !== id);
  list.push({ id, at: Date.now() });
  try {
    // Cap: conservamos los más nuevos para no crecer sin límite.
    localStorage.setItem(
      SURFACED_KEY,
      JSON.stringify(list.slice(-SURFACED_CAP)),
    );
  } catch {
    /* sin localStorage: no pasa nada */
  }
}
