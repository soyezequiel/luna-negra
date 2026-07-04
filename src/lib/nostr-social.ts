import { SimplePool, nip19, type Event } from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";
import { APP_NAME, RELAYS, SEARCH_RELAYS, gameTag } from "./constants";
import { nip05 } from "nostr-tools";
import { getActiveSigner, restoreSigner, type LunaSigner } from "./signer";
import { GAME_NOTE_FOOTER_MARK, gameNoteText } from "./game-note";

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

// Máximo de autores por filtro REQ: muchos relays acotan el tamaño del array
// `authors` y descartan en silencio lo que sobra. Por eso una consulta de
// perfiles/estados con cientos de follows se trocea en lotes y se agregan los
// resultados (antes se recortaba la lista de amigos a 150 y se perdían follows).
const AUTHORS_PER_QUERY = 100;

/**
 * Consulta a los relays por `authors` troceando en lotes para no exceder el
 * límite de los relays. Corre los lotes en paralelo y devuelve todos los eventos
 * juntos. Cada llamada incluye `kinds` (y cualquier otro tag del filtro base).
 */
async function querySyncByAuthors(
  authors: string[],
  filter: Omit<Parameters<SimplePool["querySync"]>[1], "authors">,
): Promise<Event[]> {
  if (authors.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < authors.length; i += AUTHORS_PER_QUERY) {
    chunks.push(authors.slice(i, i + AUTHORS_PER_QUERY));
  }
  const batches = await Promise.all(
    chunks.map((chunk) =>
      pool().querySync(RELAYS, { ...filter, authors: chunk }, { maxWait: MAX_WAIT }),
    ),
  );
  return batches.flat();
}

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

// Presencia 2.0 (NIP-38 auto-firmada por el juego, sin pasar por la tienda): en
// vez de la etiqueta `l:luna-negra` la ancla un tag `a` con la coordenada del
// juego (`30023:<pubkey-tienda>:<slug>`). La reconocemos como "jugando un juego de
// ESTA tienda" solo si esa coordenada la firma la tienda (su `<pubkey>`), para no
// mostrar la presencia 2.0 de otra plataforma Nostr como si fuera de acá.
function hasStoreGameCoord(
  ev: { tags: string[][] },
  storePubkey?: string | null,
): boolean {
  if (!storePubkey) return false;
  const prefix = `30023:${storePubkey}:`;
  return ev.tags.some(
    (t) => t[0] === "a" && typeof t[1] === "string" && t[1].startsWith(prefix),
  );
}

// Cache en módulo del pubkey de la tienda (público, estable). Solo se resuelve en
// el navegador vía una URL relativa; en el server (donde no hay base URL) queda
// null y `fetchStatuses` cae al criterio de la etiqueta `l:luna-negra`.
let _storePubkey: string | null | undefined;
async function resolveStorePubkey(): Promise<string | null> {
  if (_storePubkey !== undefined) return _storePubkey;
  if (typeof window === "undefined") return (_storePubkey = null);
  try {
    const res = await fetch("/api/store/pubkey");
    const data = res.ok ? await res.json() : null;
    _storePubkey = typeof data?.pubkey === "string" ? data.pubkey : null;
  } catch {
    _storePubkey = null;
  }
  // `?? null`: TS pierde el narrowing del `let` de módulo tras el `await`.
  return _storePubkey ?? null;
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

/**
 * Edita y publica el perfil del usuario (kind:0, metadata reemplazable).
 *
 * Parte del kind:0 más reciente del usuario para NO pisar campos que tenga
 * seteados en otros clientes (banner, website, nip05, etc.): solo toca las
 * claves del `patch`. Una clave con valor vacío/nulo se ELIMINA del perfil
 * (así "borrar la foto" funciona). Firma con el signer activo (extensión,
 * bunker NIP-46 o clave local) y publica a todos los relays. Devuelve el
 * metadata final ya mergeado.
 */
export async function publishProfile(
  pubkey: string,
  patch: Partial<Profile>,
): Promise<Profile> {
  let base: Record<string, unknown> = {};
  try {
    const evs = await pool().querySync(
      RELAYS,
      { kinds: [0], authors: [pubkey] },
      { maxWait: MAX_WAIT },
    );
    if (evs.length) {
      const newest = evs.reduce((a, b) => (b.created_at > a.created_at ? b : a));
      const parsed = JSON.parse(newest.content);
      if (parsed && typeof parsed === "object") base = parsed;
    }
  } catch {
    /* sin perfil previo o JSON inválido: arrancamos de cero */
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === "") delete merged[key];
    else merged[key] = value;
  }

  const ev = await sign({
    kind: 0,
    created_at: now(),
    tags: [],
    content: JSON.stringify(merged),
  });
  await publish(ev);
  return merged as Profile;
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
 *
 * El tope es solo un techo de seguridad (memoria / tamaño del POST a
 * /api/users/known): las consultas a relays ya se trocean por autor
 * (`querySyncByAuthors`), así que NO hace falta recortar para no saturarlos.
 * Antes el tope era 150 y los usuarios con muchos follows perdían a los que
 * seguían primero (la cabeza del kind:3 nunca se cargaba).
 */
export function clampContacts(contacts: string[], max = 1000): string[] {
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
  const evs = await querySyncByAuthors(pubkeys, { kinds: [0] });
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
  /** Tiene cuenta en Luna Negra (vino del directorio de miembros, no de relays). */
  isMember?: boolean;
};

/**
 * Busca miembros de Luna Negra por nombre en la DB de la tienda. Necesario
 * porque una cuenta custodial creada en la tienda puede no estar indexada en
 * ningún relay NIP-50, pero la tienda sí conoce su displayName.
 */
async function searchMembers(q: string): Promise<GlobalResult[]> {
  // Solo en el navegador: usa una URL relativa contra la propia app. En el
  // servidor (p. ej. API pública v1/friends) no hay base URL y se omite.
  if (typeof window === "undefined") return [];
  try {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      users?: { pubkey: string; npub: string; displayName?: string | null; avatarUrl?: string | null }[];
    };
    return (data.users ?? []).map((u) => ({
      pubkey: u.pubkey,
      npub: u.npub,
      profile: {
        name: u.displayName ?? undefined,
        picture: u.avatarUrl ?? undefined,
      },
      isMember: true,
    }));
  } catch {
    return [];
  }
}

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

  // 3) Texto libre: en paralelo, miembros de Luna Negra (DB) y NIP-50 (relays).
  const [members, evs] = await Promise.all([
    searchMembers(q),
    pool().querySync(
      SEARCH_RELAYS,
      { kinds: [0], search: q, limit },
      { maxWait: MAX_WAIT },
    ),
  ]);
  const byPubkey = new Map<string, (typeof evs)[number]>();
  for (const ev of evs) {
    const prev = byPubkey.get(ev.pubkey);
    if (!prev || ev.created_at > prev.created_at) byPubkey.set(ev.pubkey, ev);
  }
  const fromRelays: GlobalResult[] = [...byPubkey.values()].map((ev) => {
    let profile: Profile | undefined;
    try {
      profile = JSON.parse(ev.content) as Profile;
    } catch {
      /* perfil ilegible */
    }
    return { pubkey: ev.pubkey, npub: npubOf(ev.pubkey), profile };
  });

  // Miembros primero (resultado fiable); luego relays sin duplicar pubkeys.
  const seen = new Set(members.map((m) => m.pubkey));
  const merged = [...members];
  for (const r of fromRelays) {
    if (seen.has(r.pubkey)) continue;
    seen.add(r.pubkey);
    merged.push(r);
  }
  return merged.slice(0, limit);
}

// --- Presencia (NIP-38, kind:30315 d="general") ---

export type Status = { content: string; url?: string };
type StatusEvent = Pick<Event, "pubkey" | "created_at" | "tags" | "content">;

export function selectFreshStatuses(
  evs: StatusEvent[],
  nowSec: number = now(),
  storePubkey?: string | null,
): Record<string, Status> {
  const latest = new Map<string, StatusEvent>();
  for (const ev of evs) {
    const prev = latest.get(ev.pubkey);
    if (!prev || ev.created_at > prev.created_at) latest.set(ev.pubkey, ev);
  }

  const map: Record<string, Status> = {};
  for (const [pubkey, ev] of latest) {
    if (!ev.content) continue;
    // Aceptamos la presencia por DOS vías (el estado `d:"general"` es compartido
    // entre apps Nostr, así que ignoramos lo ajeno como "Accounts" de nostr.build):
    //  1.0 → la publicó la tienda con la etiqueta `l:luna-negra`.
    //  2.0 → la firmó el propio juego y la ancló a la coordenada de un juego de
    //        esta tienda (tag `a` = 30023:<pubkey-tienda>:<slug>).
    if (!hasLunaNegraLabel(ev) && !hasStoreGameCoord(ev, storePubkey)) continue;

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
  // No filtramos por `#l` en el relay: la presencia 2.0 (auto-firmada por el
  // juego) no lleva esa etiqueta, la ancla la coordenada `a`. Traemos todos los
  // estados `d:general` de los contactos y `selectFreshStatuses` decide cuáles son
  // de esta tienda (por etiqueta o por coordenada del juego).
  const [evs, storePubkey] = await Promise.all([
    querySyncByAuthors(pubkeys, { kinds: [30315], "#d": ["general"] }),
    resolveStorePubkey(),
  ]);
  return selectFreshStatuses(evs, undefined, storePubkey);
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
 *
 * `stateLabel` (opcional) enriquece el texto con lo que el juego reportó en su
 * heartbeat (`GamePresence.stateJson` → `deriveStateLabel`, ver social.ts):
 * "Jugando Tetris — nivel 7 en Luna Negra". Sigue siendo texto plano NIP-38, lo
 * lee cualquier cliente Nostr.
 */
export async function publishPlayingStatus(
  title: string,
  gameUrl?: string,
  ttlSeconds = 30,
  stateLabel?: string | null,
): Promise<void> {
  const tags: string[][] = [["d", "general"], lunaNegraStatusTag()];
  if (gameUrl) tags.push(["r", gameUrl]);
  tags.push(["expiration", String(now() + ttlSeconds)]);
  const content = stateLabel
    ? `Jugando ${title} — ${stateLabel} en Luna Negra`
    : `Jugando ${title} en Luna Negra`;
  await publish(
    await sign({
      kind: 30315,
      created_at: now(),
      tags,
      content,
    }),
  );
}

/**
 * ¿El usuario tiene colgado un estado NIP-38 "jugando X" de ESTA tienda que
 * todavía se ve fresco? Sirve para detectar presencias que quedaron vivas cuando
 * la pestaña de la tienda se cerró de golpe y el `clearPlayingStatus` nunca salió.
 *
 * Distingue una PRESENCIA DE JUEGO (marca luna-negra o coordenada del juego, con
 * forma de "jugando": expiración NIP-40, tag `r` de link, o el texto "Jugando … en
 * Luna Negra") de un ESTADO MANUAL de texto libre (`publishStatus`), que NO hay que
 * tocar. Sólo devuelve true para lo primero, así el reconciliador no borra un
 * estado que el usuario puso a mano.
 */
export async function hasStalePlayingStatus(pubkey: string): Promise<boolean> {
  const [evs, storePubkey] = await Promise.all([
    querySyncByAuthors([pubkey], { kinds: [30315], "#d": ["general"] }),
    resolveStorePubkey(),
  ]);
  let latest: StatusEvent | undefined;
  for (const ev of evs) {
    if (!latest || ev.created_at > latest.created_at) latest = ev;
  }
  return isLingeringPlayingStatus(latest, storePubkey);
}

/**
 * Decisión pura: ¿este es el último estado y es una presencia de juego de esta
 * tienda todavía vigente (no un estado manual, no vencido)? Extraído para poder
 * testearlo sin tocar relays.
 */
export function isLingeringPlayingStatus(
  latest: StatusEvent | undefined,
  storePubkey?: string | null,
  nowSec: number = now(),
): boolean {
  if (!latest || !latest.content) return false;
  if (!hasLunaNegraLabel(latest) && !hasStoreGameCoord(latest, storePubkey)) return false;

  // Vigencia (misma regla que selectFreshStatuses): si ya venció no se muestra,
  // así que no hace falta limpiarlo.
  const exp = latest.tags.find((t) => t[0] === "expiration")?.[1];
  if (exp) {
    const expiresAt = Number(exp);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowSec) return false;
  } else if (latest.created_at + STATUS_FALLBACK_TTL_SECONDS <= nowSec) {
    return false;
  }

  // Forma de "jugando" (no un estado manual libre).
  return (
    latest.tags.some((t) => t[0] === "expiration") ||
    latest.tags.some((t) => t[0] === "r") ||
    /jugando .+ en luna negra/i.test(latest.content)
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

// --- Actividad por juego (respuestas al artículo NIP-23 del juego) ---
//
// Al aprobar un juego, Luna Negra publica un artículo direccionable (kind:30023)
// — ver `nostr-server.ts#publishGameArticle`. Comentarios y reseñas se cuelgan de
// su COORDENADA (tag `a` root + `p` autor): así, aunque el artículo se edite (y
// cambie su id), las respuestas siguen apuntando al mismo juego. Juegos viejos
// sin `coord` se enlazan por `e` (compat). Sin artículo, los comentarios caen al
// modo "nota suelta con pie de contexto" (fallback).

/**
 * Raíz Nostr de un juego al que se cuelgan comentarios/reseñas. `coord` es la
 * coordenada direccionable del artículo NIP-23 (`30023:<pubkey>:<slug>`): es el
 * enlace ESTABLE (tag `a`), no cambia aunque se edite el artículo. `id` es el id
 * del último evento (legacy/compat: juegos viejos sin `coord` se enlazan por `e`).
 */
export type GameRoot = { id: string; pubkey: string; coord?: string | null };

export type ActivityNote = {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
};

/**
 * Trae los comentarios de un juego, combinando varios filtros para no perder
 * nada entre la migración a artículo:
 * - `#a` [coord]: respuestas a la coordenada del artículo NIP-23 (lo nuevo/estable).
 * - `#t` [gameTag]: notas tagueadas por slug (comentarios + fallback sin artículo).
 * - `#e` [root.id]: respuestas colgadas del id del evento (juegos viejos kind:1).
 * Deduplica por id y excluye el propio artículo/anuncio.
 */
export async function fetchGameActivity(
  slug: string,
  root?: GameRoot | null,
): Promise<ActivityNote[]> {
  const filters: Parameters<SimplePool["querySync"]>[1][] = [
    { kinds: [1], "#t": [gameTag(slug)] },
  ];
  if (root?.coord) filters.push({ kinds: [1], "#a": [root.coord] });
  if (root?.id) filters.push({ kinds: [1], "#e": [root.id] });
  const batches = await Promise.all(
    filters.map((f) => pool().querySync(RELAYS, f)),
  );
  const byId = new Map<string, (typeof batches)[number][number]>();
  for (const e of batches.flat()) byId.set(e.id, e);
  return [...byId.values()]
    .filter((e) => e.id !== root?.id) // el artículo no es un comentario
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 50)
    .map((e) => ({
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      created_at: e.created_at,
    }));
}

// Pie de contexto de las notas de juego: GAME_NOTE_FOOTER_MARK / gameNoteText
// viven en game-note.ts (server-safe), importados arriba.

// Tags de respuesta al artículo del juego. Preferimos la coordenada `a` (estable
// entre ediciones); para juegos viejos sin `coord` caemos al `e` por id de evento.
function replyTags(root: GameRoot, gameUrl: string): string[][] {
  const rootTag = root.coord
    ? ["a", root.coord, "", "root"]
    : ["e", root.id, "", "root"];
  return [rootTag, ["p", root.pubkey], ["r", gameUrl]];
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
 * Comparte un juego en Nostr como nota propia (kind:1) firmada por el usuario.
 * A diferencia de `publishGameNote`/`publishGameReview`, NO es una respuesta al
 * hilo del juego: es una nota suelta que aparece en el feed de los seguidores
 * del usuario. Con el link a la tienda (que ya emite preview social con la
 * carátula) es difusión orgánica que trae visitas a Luna Negra.
 *
 * Tags: `t` (slug, para poder listarlas por juego) + `r` (link). Si el juego
 * tiene artículo NIP-23 se agrega un `a` de tipo "mention" para enganchar la
 * nota con la coordenada estable (sin convertirla en reply). Devuelve el id del
 * evento publicado (para enlazar a un visor como njump).
 */
export async function publishGameShare(
  slug: string,
  content: string,
  gameUrl: string,
  images: string[] = [],
  root?: GameRoot | null,
): Promise<string> {
  const text = content.trim();
  const tags: string[][] = [["t", gameTag(slug)], ["r", gameUrl]];
  if (root?.coord) tags.push(["a", root.coord, "", "mention"]);
  // El link va siempre en el contenido: alimenta el preview social y lo ven los
  // clientes que no renderizan el tag `r`.
  const lines = [text.includes(gameUrl) ? text : `${text}\n\n${gameUrl}`];
  // Imágenes adjuntas: la URL en el contenido (los clientes la renderizan inline)
  // + un tag `imeta` (NIP-92) para que las traten como media, no como link suelto.
  for (const img of images) {
    if (!img) continue;
    lines.push(img);
    tags.push(["imeta", `url ${img}`]);
  }
  const ev = await sign({
    kind: 1,
    created_at: now(),
    tags,
    content: lines.join("\n"),
  });
  await publish(ev);
  return ev.id;
}

// Re-export para el cliente: el texto sin el pie de contexto (ver game-note.ts).
export { gameNoteText };

// --- Chat (NIP-04, kind:4) ---

export async function fetchDmEvents(myPubkey: string): Promise<Event[]> {
  const [recv, sent, nip17] = await Promise.all([
    pool().querySync(RELAYS, { kinds: [4], "#p": [myPubkey] }),
    pool().querySync(RELAYS, { kinds: [4], authors: [myPubkey] }),
    // NIP-17 (kind:14 ya desenvueltos). Best-effort: si el firmante no soporta
    // NIP-44 o los relays fallan, el chat sigue con solo los NIP-04.
    fetchNip17Rumors(myPubkey).catch(() => [] as Event[]),
  ]);
  const map = new Map<string, Event>();
  for (const e of [...recv, ...sent, ...nip17]) map.set(e.id, e);
  return [...map.values()].sort((a, b) => a.created_at - b.created_at);
}

export function dmCounterpart(ev: Event, myPubkey: string): string {
  if (ev.pubkey === myPubkey) {
    return ev.tags.find((t) => t[0] === "p")?.[1] ?? "";
  }
  return ev.pubkey;
}

export async function decryptDm(ev: Event, myPubkey: string): Promise<string> {
  // NIP-17: el rumor kind:14 ya viene descifrado (unwrapGiftWrap dejó el content
  // en claro), no pasa por NIP-04.
  if (ev.kind === NIP17_RUMOR_KIND) return ev.content;
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
  const nip04Sub = pool().subscribe(
    RELAYS,
    { kinds: [4], "#p": [myPubkey], since },
    { onevent: onEvent },
  );
  // NIP-17: el gift-wrap lleva created_at aleatorizado al pasado (NIP-59), así que
  // NO podemos filtrar por `since` como en kind:4 sin perder mensajes nuevos —
  // usamos la ventana de lookback y, tras desenvolver, emitimos solo los rumores
  // cuya hora REAL (rumor.created_at) es ≥ el arranque de la sub. Así el consumidor
  // (chat / notificaciones) ve los nuevos sin re-disparar el histórico del replay.
  const nip17Sub = pool().subscribe(
    RELAYS,
    { kinds: [NIP17_WRAP_KIND], "#p": [myPubkey], since: now() - NIP17_LOOKBACK },
    {
      onevent: (ev) => {
        void unwrapGiftWrap(ev).then((rumor) => {
          if (rumor && rumor.created_at >= since - 60) onEvent(rumor);
        });
      },
    },
  );
  return {
    close: () => {
      try {
        nip04Sub.close();
      } catch {
        /* ignore */
      }
      try {
        nip17Sub.close();
      } catch {
        /* ignore */
      }
    },
  };
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

// --- Chat NIP-17 (gift-wrap kind:1059 → seal kind:13 → rumor kind:14) ---
//
// El chat legacy de arriba es NIP-04 (kind:4). NIP-17 es el DM moderno: cifrado
// con NIP-44 y envuelto en tres capas para no filtrar metadatos. Leerlo acá hace
// que mensajes/retos enviados por clientes modernos —p. ej. el reto 1v1 que manda
// un juego integrado (TETRA)— aparezcan en el chat de Luna Negra junto a los
// NIP-04, en vez de quedar invisibles porque solo consultábamos kind:4.

const NIP17_RUMOR_KIND = 14;
const NIP17_SEAL_KIND = 13;
const NIP17_WRAP_KIND = 1059;
// Los gift-wrap llevan created_at aleatorizado hasta ~2 días atrás (NIP-59), así
// que la ventana de lectura mira algo más para no perder mensajes recientes.
const NIP17_LOOKBACK = 3 * 24 * 60 * 60;
// Tope de sobres a desenvolver por carga (cada uno son 2 descifrados NIP-44).
const NIP17_MAX_UNWRAP = 200;

// Caché de desenvoltura por id de gift-wrap (incluye negativos): evita re-descifrar
// el mismo sobre en cada refresco de la sesión.
const nip17UnwrapCache = new Map<string, Event | null>();

/** Purga la caché de rumores NIP-17 descifrados (llamar al cerrar sesión). */
export function clearNip17Cache(): void {
  nip17UnwrapCache.clear();
}

/** Signer activo si soporta NIP-44 (necesario para NIP-17), o null. */
async function dmSigner(): Promise<LunaSigner | null> {
  const signer = getActiveSigner() ?? (await restoreSigner());
  return signer?.nip44Decrypt ? signer : null;
}

/**
 * Relays de la bandeja de DM del usuario: RELAYS ∪ sus `kind:10050` (NIP-17).
 * DEBE ser el mismo set en el que un emisor publica hacia él, o el DM aterriza en
 * un relay que no leemos (asimetría que hace "el mensaje no llega"). Best-effort.
 */
async function dmInboxRelays(pubkey: string): Promise<string[]> {
  const relays = new Set(RELAYS);
  try {
    const evs = await pool().querySync(
      RELAYS,
      { kinds: [10050], authors: [pubkey] },
      { maxWait: MAX_WAIT },
    );
    if (evs.length) {
      const newest = evs.reduce((a, b) => (b.created_at > a.created_at ? b : a));
      for (const t of newest.tags) {
        if (t[0] === "relay" && typeof t[1] === "string") relays.add(t[1]);
      }
    }
  } catch {
    /* sin lista propia: solo el fallback */
  }
  return [...relays];
}

/**
 * Desenvuelve un gift-wrap a su rumor `kind:14` (con `content` en claro), o null.
 * Verifica que el autor del rumor sea quien firmó el seal (anti-suplantación
 * NIP-59). Best-effort, cacheado por id, nunca lanza. Exportado para testear.
 */
export async function unwrapGiftWrap(wrap: Event): Promise<Event | null> {
  if (wrap.kind !== NIP17_WRAP_KIND) return null;
  const cached = nip17UnwrapCache.get(wrap.id);
  if (cached !== undefined) return cached;
  let rumor: Event | null = null;
  try {
    const signer = await dmSigner();
    if (signer?.nip44Decrypt) {
      const seal = JSON.parse(
        await signer.nip44Decrypt(wrap.pubkey, wrap.content),
      ) as Event;
      if (seal && seal.kind === NIP17_SEAL_KIND && typeof seal.pubkey === "string") {
        const inner = JSON.parse(
          await signer.nip44Decrypt(seal.pubkey, seal.content),
        ) as Event;
        if (
          inner &&
          inner.kind === NIP17_RUMOR_KIND &&
          inner.pubkey === seal.pubkey
        ) {
          // El rumor no va firmado (NIP-59): puede no traer id. Le damos uno estable
          // (el del sobre) para dedup/keys aguas abajo.
          if (!inner.id) inner.id = wrap.id;
          rumor = inner;
        }
      }
    }
  } catch {
    rumor = null;
  }
  nip17UnwrapCache.set(wrap.id, rumor);
  return rumor;
}

/**
 * Si el evento es un reto/invitación NIP-17 (rumor kind:14 con un tag `url`
 * http(s)), devuelve ese link de sala; si no, null. El chat lo usa para pintar un
 * botón "Unirse a la partida" que abre el juego directo en la sala del reto.
 */
export function challengeUrlFromEvent(ev: Event): string | null {
  if (ev.kind !== NIP17_RUMOR_KIND) return null;
  const url = ev.tags.find((t) => t[0] === "url")?.[1];
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
}

/**
 * Trae los rumores NIP-17 (kind:14, `content` en claro) dirigidos a `myPubkey`.
 * Se mezclan con los kind:4 en `fetchDmEvents`; `decryptDm` los pasa tal cual.
 */
async function fetchNip17Rumors(myPubkey: string): Promise<Event[]> {
  const signer = await dmSigner();
  if (!signer) return [];
  const relays = await dmInboxRelays(myPubkey);
  let wraps: Event[];
  try {
    wraps = await pool().querySync(
      relays,
      { kinds: [NIP17_WRAP_KIND], "#p": [myPubkey], since: now() - NIP17_LOOKBACK },
      { maxWait: MAX_WAIT },
    );
  } catch {
    return [];
  }
  // Dedup por id (multi-relay) y desenvolvemos los más recientes primero.
  const byId = new Map<string, Event>();
  for (const w of wraps) byId.set(w.id, w);
  const recent = [...byId.values()]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, NIP17_MAX_UNWRAP);
  const rumors: Event[] = [];
  for (const w of recent) {
    const r = await unwrapGiftWrap(w);
    if (r) rumors.push(r);
  }
  return rumors;
}
