import { SimplePool, nip19, type Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { APP_NAME, RELAYS } from "./constants";

export type Profile = {
  name?: string;
  display_name?: string;
  displayName?: string;
  picture?: string;
  about?: string;
  lud16?: string;
};

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

const now = () => Math.floor(Date.now() / 1000);

// Tope de espera por consulta a relays: si un relay está caído o lento, no
// bloquea el resto (nostr-tools resuelve con lo recibido al cumplirse el plazo).
const MAX_WAIT = 4000;

export function npubOf(pubkey: string): string {
  return nip19.npubEncode(pubkey);
}

export function pubkeyFromNpub(npub: string): string | null {
  try {
    const d = nip19.decode(npub.trim());
    return d.type === "npub" ? (d.data as string) : null;
  } catch {
    return null;
  }
}

export function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…` : value;
}

export function profileName(p: Profile | undefined, fallback: string): string {
  return p?.displayName || p?.display_name || p?.name || fallback;
}

async function sign(unsigned: {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}): Promise<Event> {
  if (!window.nostr) throw new Error("Necesitás una extensión Nostr (nos2x/Alby)");
  return (await window.nostr.signEvent(unsigned)) as unknown as Event;
}

async function publish(ev: Event): Promise<void> {
  await Promise.allSettled(pool().publish(RELAYS, ev));
}

// Kinds que Luna Negra firma con la extensión: 1 (notas), 4 (DM),
// 27235 (login NIP-98), 30315 (presencia NIP-38).
const SIGN_KINDS = [1, 4, 27235, 30315];

/**
 * "Calienta" los permisos NIP-07 al inicio de la sesión: dispara una vez cada
 * operación que usa Luna Negra (nip04 encrypt/decrypt + signEvent de cada kind)
 * para que el usuario los apruebe todos juntos (marcando "recordar" en la
 * extensión) y no le salten permisos por cada acción.
 *
 * Best-effort: los eventos NO se publican y cada denegación se ignora.
 */
export async function warmUpPermissions(pubkey: string): Promise<void> {
  const nostr = window.nostr;
  if (!nostr) return;

  // nip04: lo más repetitivo (chat + notificaciones descifran constantemente).
  if (nostr.nip04) {
    try {
      const ct = await nostr.nip04.encrypt(pubkey, "warmup");
      await nostr.nip04.decrypt(pubkey, ct);
    } catch {
      /* permiso denegado: seguimos */
    }
  }

  // signEvent por cada kind (eventos descartables, nunca se publican).
  for (const kind of SIGN_KINDS) {
    try {
      await nostr.signEvent({ kind, created_at: now(), tags: [], content: "" });
    } catch {
      /* permiso denegado: seguimos */
    }
  }
}

// --- Amigos (NIP-02) y perfiles (kind:0) ---

export async function fetchContacts(pubkey: string): Promise<string[]> {
  const ev = await pool().get(
    RELAYS,
    { kinds: [3], authors: [pubkey] },
    { maxWait: MAX_WAIT },
  );
  if (!ev) return [];
  return ev.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
}

export async function fetchProfiles(
  pubkeys: string[],
): Promise<Record<string, Profile>> {
  if (pubkeys.length === 0) return {};
  const evs = await pool().querySync(
    RELAYS,
    { kinds: [0], authors: pubkeys },
    { maxWait: MAX_WAIT },
  );
  const map: Record<string, Profile> = {};
  for (const ev of evs.sort((a, b) => a.created_at - b.created_at)) {
    try {
      map[ev.pubkey] = JSON.parse(ev.content) as Profile;
    } catch {
      /* ignore */
    }
  }
  return map;
}

// --- Presencia (NIP-38, kind:30315 d="general") ---

export type Status = { content: string; url?: string };

export async function fetchStatuses(
  pubkeys: string[],
): Promise<Record<string, Status>> {
  if (pubkeys.length === 0) return {};
  const evs = await pool().querySync(
    RELAYS,
    {
      kinds: [30315],
      authors: pubkeys,
      "#d": ["general"],
    },
    { maxWait: MAX_WAIT },
  );
  const map: Record<string, Status> = {};
  // Ascendente → el último (más nuevo) gana.
  for (const ev of evs.sort((a, b) => a.created_at - b.created_at)) {
    if (!ev.content) continue;
    const url = ev.tags.find((t) => t[0] === "r")?.[1];
    map[ev.pubkey] = { content: ev.content, url: url || undefined };
  }
  return map;
}

export async function publishStatus(content: string): Promise<void> {
  await publish(
    await sign({
      kind: 30315,
      created_at: now(),
      tags: [["d", "general"]],
      content,
    }),
  );
}

/**
 * Auto-publica presencia "jugando X" (NIP-38) al lanzar un juego.
 * Best-effort: incluye link al juego y expira (por defecto 1h) para que se
 * limpie solo. El contenido NO lleva emoji (la UI de /friends antepone 🎮).
 */
export async function publishPlayingStatus(
  title: string,
  gameUrl?: string,
  ttlSeconds = 3600,
): Promise<void> {
  const tags: string[][] = [["d", "general"]];
  if (gameUrl) tags.push(["r", gameUrl]);
  tags.push(["expiration", String(now() + ttlSeconds)]);
  await publish(
    await sign({
      kind: 30315,
      created_at: now(),
      tags,
      content: `Jugando ${title} en Luna Negra`,
    }),
  );
}

/**
 * Limpia la presencia "jugando" (NIP-38): publica un estado vacío con
 * expiración inmediata para que los amigos dejen de ver el juego como abierto
 * (`fetchStatuses` ignora los estados sin contenido). Best-effort.
 */
export async function clearPlayingStatus(): Promise<void> {
  await publish(
    await sign({
      kind: 30315,
      created_at: now(),
      tags: [
        ["d", "general"],
        ["expiration", String(now() + 1)],
      ],
      content: "",
    }),
  );
}

// --- Actividad por juego (kind:1 con tag lunanegra:game:<slug>) ---

export function gameTag(slug: string): string {
  return `lunanegra:game:${slug}`;
}

export type ActivityNote = {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
};

export async function fetchGameActivity(slug: string): Promise<ActivityNote[]> {
  const evs = await pool().querySync(RELAYS, {
    kinds: [1],
    "#t": [gameTag(slug)],
  });
  return evs
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 50)
    .map((e) => ({
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      created_at: e.created_at,
    }));
}

// Marca que separa el texto del usuario del pie de contexto. Empezar el pie con
// este string permite recortarlo al mostrar la nota dentro de Luna Negra.
const GAME_NOTE_FOOTER_MARK = "\n\n🎮 Sobre «";

/**
 * Publica un comentario de juego como kind:1. El `content` lleva un pie con el
 * título, link a la ficha y mención de Luna Negra para que la nota tenga
 * contexto en cualquier cliente Nostr (no solo dentro de la tienda).
 */
export async function publishGameNote(
  slug: string,
  content: string,
  title: string,
  gameUrl: string,
): Promise<void> {
  const footer = `${GAME_NOTE_FOOTER_MARK}${title}» en ${APP_NAME}\n${gameUrl}`;
  await publish(
    await sign({
      kind: 1,
      created_at: now(),
      tags: [
        ["t", gameTag(slug)],
        ["r", gameUrl],
      ],
      content: `${content.trim()}${footer}`,
    }),
  );
}

/**
 * Devuelve solo el texto que escribió el usuario, sin el pie de contexto que
 * `publishGameNote` agrega. Las notas antiguas (sin pie) se devuelven intactas.
 */
export function gameNoteText(content: string): string {
  const i = content.indexOf(GAME_NOTE_FOOTER_MARK);
  return i === -1 ? content : content.slice(0, i);
}

// --- Chat (NIP-04, kind:4) ---

export async function fetchDmEvents(myPubkey: string): Promise<Event[]> {
  const [recv, sent] = await Promise.all([
    pool().querySync(RELAYS, { kinds: [4], "#p": [myPubkey] }),
    pool().querySync(RELAYS, { kinds: [4], authors: [myPubkey] }),
  ]);
  const map = new Map<string, Event>();
  for (const e of [...recv, ...sent]) map.set(e.id, e);
  return [...map.values()].sort((a, b) => a.created_at - b.created_at);
}

export function dmCounterpart(ev: Event, myPubkey: string): string {
  if (ev.pubkey === myPubkey) {
    return ev.tags.find((t) => t[0] === "p")?.[1] ?? "";
  }
  return ev.pubkey;
}

export async function decryptDm(ev: Event, myPubkey: string): Promise<string> {
  if (!window.nostr?.nip04) return "[tu extensión no soporta NIP-04]";
  try {
    return await window.nostr.nip04.decrypt(dmCounterpart(ev, myPubkey), ev.content);
  } catch {
    return "[no se pudo descifrar]";
  }
}

/**
 * Suscripción en vivo a DMs entrantes (kind:4 dirigidos a `myPubkey`).
 * `since` (segundos) acota al presente para no re-notificar el historial.
 * Devuelve un SubCloser; el caller debe llamar `.close()` al desmontar.
 */
export function subscribeDms(
  myPubkey: string,
  onEvent: (ev: Event) => void,
  since: number = now(),
): SubCloser {
  return pool().subscribe(
    RELAYS,
    { kinds: [4], "#p": [myPubkey], since },
    { onevent: onEvent },
  );
}

export async function sendDm(
  recipientPubkey: string,
  text: string,
): Promise<void> {
  if (!window.nostr?.nip04) throw new Error("Tu extensión no soporta NIP-04");
  const ciphertext = await window.nostr.nip04.encrypt(recipientPubkey, text);
  await publish(
    await sign({
      kind: 4,
      created_at: now(),
      tags: [["p", recipientPubkey]],
      content: ciphertext,
    }),
  );
}
