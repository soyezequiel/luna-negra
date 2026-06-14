import { SimplePool, nip19, type Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { APP_NAME, RELAYS, SEARCH_RELAYS, gameTag } from "./constants";
import { nip05 } from "nostr-tools";
import { getActiveSigner, restoreSigner, type LunaSigner } from "./signer";

export type Profile = {
  name?: string;
  display_name?: string;
  displayName?: string;
  picture?: string;
  about?: string;
  lud16?: string;
  nip05?: string;
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
// Compatibilidad defensiva: versiones viejas o clientes externos pueden publicar
// presencia sin NIP-40. Sin expiracion explicita, no puede vivir para siempre.
// Aumentado a 3600s (1 hora) para evitar que los estados personalizados sin
// expiración explícita (como los publicados a mano) desaparezcan en 2 minutos.
export const STATUS_FALLBACK_TTL_SECONDS = 3600;

// Marca que distingue la presencia NIP-38 publicada DESDE Luna Negra de la que
// el mismo `d:"general"` pueda tener seteada por otra app Nostr. El estado
// `general` es global y compartido entre clientes: sin esta marca, el riel
// "amigos jugando" mostraría cualquier estado ajeno (p. ej. "Accounts" puesto
// por nostr.build) como si fuera un juego abierto en la tienda. Usamos un tag de
// una sola letra ("l", etiqueta NIP-32) para poder filtrar también en el relay.
const LN_STATUS_LABEL = "luna-negra";
const lunaNegraStatusTag = (): string[] => ["l", LN_STATUS_LABEL];
function hasLunaNegraLabel(ev: { tags: string[][] }): boolean {
  return ev.tags.some((t) => t[0] === "l" && t[1] === LN_STATUS_LABEL);
}

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

/** Signer activo (restaurándolo si la app recién monta); lanza si no hay. */
async function requireSigner(): Promise<LunaSigner> {
  const signer = getActiveSigner() ?? (await restoreSigner());
  if (!signer) throw new Error("Conectá tu Nostr para continuar");
  return signer;
}

async function sign(unsigned: {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}): Promise<Event> {
  const signer = await requireSigner();
  try {
    return await signer.signEvent(unsigned);
  } catch {
    throw new Error(
      signer.method === "nip07"
        ? "Permiso denegado en tu extensión Nostr"
        : "Tu firmante Nostr rechazó la firma",
    );
  }
}

async function publish(ev: Event): Promise<void> {
  await Promise.allSettled(pool().publish(RELAYS, ev));
}

// Kinds que Luna Negra firma con la extensión: 1 (notas), 3 (follows NIP-02),
// 4 (DM), 27235 (login NIP-98), 30315 (presencia NIP-38).
const SIGN_KINDS = [1, 3, 4, 27235, 30315];

// --- Modo de permisos NIP-07 ---
//
// "lazy" (default): cada función pide su permiso a la extensión recién cuando
// se usa (comentar pide kind:1, el chat pide nip04, etc.), y el usuario decide
// en cada prompt de nos2x/Alby si lo recuerda para siempre o no.
// "all": al iniciar sesión se "calientan" todos los permisos de una vez
// (comportamiento anterior), pensado para quien prefiere aprobar todo junto.

export type NostrPermsMode = "lazy" | "all";

const PERMS_MODE_KEY = "ln_nostr_perms";

export function getNostrPermsMode(): NostrPermsMode {
  if (typeof window === "undefined") return "lazy";
  try {
    return localStorage.getItem(PERMS_MODE_KEY) === "all" ? "all" : "lazy";
  } catch {
    return "lazy";
  }
}

export function setNostrPermsMode(mode: NostrPermsMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PERMS_MODE_KEY, mode);
  } catch {
    /* localStorage bloqueado: el modo queda en el default */
  }
}

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
  // Solo aplica al login por extensión: con clave local no hay prompts y con
  // NIP-46 los permisos los gestiona el bunker remoto.
  const method = getActiveSigner()?.method;
  if (method && method !== "nip07") return;

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
  // Se consulta a TODOS los relays y se toma el kind:3 más nuevo: `pool.get`
  // devuelve el primero en responder, que puede ser una contact list vieja de
  // un relay desactualizado (por eso un follow recién hecho tardaba en aparecer).
  const evs = await pool().querySync(
    RELAYS,
    { kinds: [3], authors: [pubkey] },
    { maxWait: MAX_WAIT },
  );
  return contactsFromLatest(evs);
}

/** Tags `p` del evento kind:3 más nuevo del lote. Exportado para testear. */
export function contactsFromLatest(
  evs: Pick<Event, "created_at" | "tags">[],
): string[] {
  let latest: Pick<Event, "created_at" | "tags"> | null = null;
  for (const ev of evs) {
    if (!latest || ev.created_at > latest.created_at) latest = ev;
  }
  if (!latest) return [];
  return latest.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
}

/**
 * Acota la lista de contactos sin perder los follows recientes: los clientes
 * Nostr appendean los nuevos al final del kind:3, así que se conserva la COLA
 * (un `slice(0, max)` tiraba justo a los últimos seguidos). Deduplica
 * conservando la última aparición y mantiene el orden relativo.
 */
export function clampContacts(contacts: string[], max = 150): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = contacts.length - 1; i >= 0 && out.length < max; i--) {
    const pk = contacts[i];
    if (!seen.has(pk)) {
      seen.add(pk);
      out.push(pk);
    }
  }
  return out.reverse();
}

/** Trae el evento kind:3 (lista de contactos) más nuevo del usuario, o null. */
async function fetchContactEvent(pubkey: string): Promise<Event | null> {
  const evs = await pool().querySync(
    RELAYS,
    { kinds: [3], authors: [pubkey] },
    { maxWait: MAX_WAIT },
  );
  let latest: Event | null = null;
  for (const ev of evs) {
    if (!latest || ev.created_at > latest.created_at) latest = ev;
  }
  return latest;
}

/**
 * Sigue a un usuario (NIP-02): toma tu kind:3 más nuevo, le agrega el tag `p`
 * del pubkey conservando el resto de contactos, los relays (content) y los
 * petnames, y republica. Devuelve true si hubo cambio, false si ya lo seguías.
 *
 * Importante: se relee el kind:3 vigente justo antes de firmar para no pisar
 * follows hechos en otros clientes (republicar una lista vieja borraría amigos).
 */
export async function followContact(pubkey: string): Promise<boolean> {
  const signer = await requireSigner();
  const myPubkey = await signer.getPublicKey();
  const current = await fetchContactEvent(myPubkey);
  const tags = current ? current.tags.map((t) => [...t]) : [];
  if (tags.some((t) => t[0] === "p" && t[1] === pubkey)) return false;
  tags.push(["p", pubkey]);
  await publish(
    await sign({
      kind: 3,
      created_at: now(),
      tags,
      content: current?.content ?? "",
    }),
  );
  return true;
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

// --- Búsqueda global de usuarios (cuando no aparece en tus follows) ---

export type GlobalResult = {
  pubkey: string;
  npub: string;
  profile?: Profile;
};

/**
 * Busca usuarios en TODO Nostr cuando no están en tus follows. Resuelve, en
 * este orden: un npub pegado, un identificador NIP-05 (`usuario@dominio`), o
 * texto libre vía NIP-50 (full-text de kind:0 en relays de búsqueda).
 */
export async function searchProfiles(
  query: string,
  limit = 10,
): Promise<GlobalResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // 1) npub pegado directo.
  const direct = pubkeyFromNpub(q);
  if (direct) {
    const profiles = await fetchProfiles([direct]);
    return [{ pubkey: direct, npub: npubOf(direct), profile: profiles[direct] }];
  }

  // 2) NIP-05 (usuario@dominio).
  if (q.includes("@")) {
    try {
      const resolved = await nip05.queryProfile(q);
      if (resolved?.pubkey) {
        const profiles = await fetchProfiles([resolved.pubkey]);
        return [
          {
            pubkey: resolved.pubkey,
            npub: npubOf(resolved.pubkey),
            profile: profiles[resolved.pubkey],
          },
        ];
      }
    } catch {
      /* NIP-05 no resoluble: cae a búsqueda por texto */
    }
  }

  // 3) Texto libre (NIP-50).
  const evs = await pool().querySync(
    SEARCH_RELAYS,
    { kinds: [0], search: q, limit },
    { maxWait: MAX_WAIT },
  );
  const byPubkey = new Map<string, (typeof evs)[number]>();
  for (const ev of evs) {
    const prev = byPubkey.get(ev.pubkey);
    if (!prev || ev.created_at > prev.created_at) byPubkey.set(ev.pubkey, ev);
  }
  return [...byPubkey.values()].slice(0, limit).map((ev) => {
    let profile: Profile | undefined;
    try {
      profile = JSON.parse(ev.content) as Profile;
    } catch {
      /* perfil ilegible */
    }
    return { pubkey: ev.pubkey, npub: npubOf(ev.pubkey), profile };
  });
}

// --- Presencia (NIP-38, kind:30315 d="general") ---

export type Status = { content: string; url?: string };
type StatusEvent = Pick<Event, "pubkey" | "created_at" | "tags" | "content">;

export function selectFreshStatuses(
  evs: StatusEvent[],
  nowSec: number = now(),
): Record<string, Status> {
  const latest = new Map<string, StatusEvent>();
  for (const ev of evs) {
    const prev = latest.get(ev.pubkey);
    if (!prev || ev.created_at > prev.created_at) latest.set(ev.pubkey, ev);
  }

  const map: Record<string, Status> = {};
  for (const [pubkey, ev] of latest) {
    if (!ev.content) continue;
    // Solo presencia originada en Luna Negra: ignoramos estados `general`
    // seteados por otras apps Nostr (el `d:"general"` es compartido).
    if (!hasLunaNegraLabel(ev)) continue;

    const exp = ev.tags.find((t) => t[0] === "expiration")?.[1];
    if (exp) {
      const expiresAt = Number(exp);
      if (!Number.isFinite(expiresAt) || expiresAt <= nowSec) continue;
    } else if (ev.created_at + STATUS_FALLBACK_TTL_SECONDS <= nowSec) {
      continue;
    }

    const url = ev.tags.find((t) => t[0] === "r")?.[1];
    map[pubkey] = { content: ev.content, url: url || undefined };
  }
  return map;
}

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
      "#l": [LN_STATUS_LABEL],
    },
    { maxWait: MAX_WAIT },
  );
  return selectFreshStatuses(evs);
}

export async function publishStatus(content: string): Promise<void> {
  await publish(
    await sign({
      kind: 30315,
      created_at: now(),
      tags: [["d", "general"], lunaNegraStatusTag()],
      content,
    }),
  );
}

/**
 * Publica/renueva la presencia "jugando X" (NIP-38). Best-effort: incluye link
 * al juego y una expiración corta (NIP-40). El lifecycle lo gobierna
 * `playing-presence.ts`: se re-llama mientras la API confirme que el jugador sigue
 * jugando y la expiración corta hace que el estado se auto-limpie si la tienda
 * muere sin poder publicar el `clearPlayingStatus`. El contenido NO lleva emoji
 * (la UI antepone 🎮).
 */
export async function publishPlayingStatus(
  title: string,
  gameUrl?: string,
  ttlSeconds = 30,
): Promise<void> {
  const tags: string[][] = [["d", "general"], lunaNegraStatusTag()];
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

// --- Actividad por juego (respuestas NIP-10 al anuncio del juego) ---
//
// Al aprobar un juego, Luna Negra publica un anuncio (kind:1) — ver
// `nostr-server.ts#publishGameAnnouncement`. Comentarios y reseñas se cuelgan de
// ese anuncio como respuestas (tags `e` root + `p` autor), de modo que en
// cualquier cliente Nostr se ven dentro del hilo del juego y no como notas
// sueltas. Si el juego todavía no tiene anuncio, los comentarios caen al modo
// "nota suelta con pie de contexto" (fallback).

/** Anuncio raíz de un juego en Nostr, al que se responde con comentarios/reseñas. */
export type GameRoot = { id: string; pubkey: string };

export type ActivityNote = {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
};

/**
 * Trae los comentarios de un juego. Si hay anuncio (`rootId`), pide las
 * respuestas a ese evento (`#e`); además sigue trayendo notas con el tag `t`
 * (compatibilidad con comentarios viejos y el fallback). El propio anuncio se
 * excluye del listado.
 */
export async function fetchGameActivity(
  slug: string,
  rootId?: string | null,
): Promise<ActivityNote[]> {
  const filters: Parameters<SimplePool["querySync"]>[1][] = [
    { kinds: [1], "#t": [gameTag(slug)] },
  ];
  if (rootId) filters.push({ kinds: [1], "#e": [rootId] });
  const batches = await Promise.all(
    filters.map((f) => pool().querySync(RELAYS, f)),
  );
  const byId = new Map<string, (typeof batches)[number][number]>();
  for (const e of batches.flat()) byId.set(e.id, e);
  return [...byId.values()]
    .filter((e) => e.id !== rootId) // el anuncio no es un comentario
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 50)
    .map((e) => ({
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      created_at: e.created_at,
    }));
}

// Marca que separa el texto del usuario del pie de contexto (modo fallback,
// cuando el juego aún no tiene anuncio raíz). Empezar el pie con este string
// permite recortarlo al mostrar la nota dentro de Luna Negra.
const GAME_NOTE_FOOTER_MARK = "\n\n🎮 Sobre «";

function replyTags(root: GameRoot, gameUrl: string): string[][] {
  return [
    ["e", root.id, "", "root"],
    ["p", root.pubkey],
    ["r", gameUrl],
  ];
}

/**
 * Publica un comentario de juego como kind:1.
 * - Con anuncio (`root`): respuesta NIP-10 al hilo del juego; el contenido es el
 *   texto tal cual (el contexto lo da el hilo). Lleva el tag `t` para poder
 *   listarlo también por juego.
 * - Sin anuncio: nota suelta con un pie (título + link + Luna Negra) para que
 *   tenga contexto igual en cualquier cliente.
 */
export async function publishGameNote(
  slug: string,
  content: string,
  title: string,
  gameUrl: string,
  root?: GameRoot | null,
): Promise<void> {
  const text = content.trim();
  const tags: string[][] = [["t", gameTag(slug)]];
  let body: string;
  if (root) {
    tags.push(...replyTags(root, gameUrl).filter((t) => t[0] !== "t"));
    body = text;
  } else {
    tags.push(["r", gameUrl]);
    body = `${text}${GAME_NOTE_FOOTER_MARK}${title}» en ${APP_NAME}\n${gameUrl}`;
  }
  await publish(await sign({ kind: 1, created_at: now(), tags, content: body }));
}

/**
 * Publica una reseña como respuesta NIP-10 al anuncio del juego, firmada por el
 * usuario. El rating se persiste en la DB aparte (para el promedio); acá solo se
 * deja la reseña visible en el hilo público. NO lleva el tag `t` para no
 * mezclarse con los comentarios en `fetchGameActivity`.
 */
export async function publishGameReview(
  root: GameRoot,
  rating: number,
  body: string,
  title: string,
  gameUrl: string,
): Promise<void> {
  const stars = "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));
  const header = `${stars} (${rating}/5) · Reseña de «${title}» en ${APP_NAME}`;
  const text = body.trim();
  await publish(
    await sign({
      kind: 1,
      created_at: now(),
      tags: replyTags(root, gameUrl),
      content: text ? `${header}\n\n${text}` : header,
    }),
  );
}

/**
 * Devuelve solo el texto que escribió el usuario, sin el pie de contexto del
 * modo fallback. Las notas sin pie (respuestas o notas viejas) van intactas.
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
  try {
    const signer = await requireSigner();
    return await signer.nip04Decrypt(dmCounterpart(ev, myPubkey), ev.content);
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
  const signer = await requireSigner();
  let ciphertext: string;
  try {
    ciphertext = await signer.nip04Encrypt(recipientPubkey, text);
  } catch {
    throw new Error(
      signer.method === "nip07"
        ? "Permiso denegado en tu extensión Nostr"
        : "Tu firmante Nostr rechazó el cifrado del mensaje",
    );
  }
  await publish(
    await sign({
      kind: 4,
      created_at: now(),
      tags: [["p", recipientPubkey]],
      content: ciphertext,
    }),
  );
}
