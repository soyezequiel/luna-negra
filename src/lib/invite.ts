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

/** Path relativo para los <Link> internos de la app. */
export function inviteHref({ slug, roomId }: Invite): string {
  return `/game/${slug}?room=${encodeURIComponent(roomId)}`;
}
