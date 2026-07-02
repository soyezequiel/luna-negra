"use client";

/**
 * Caché local de DMs (NIP-04) para que el chat pinte al instante en vez de
 * esperar 4-5s a los relays + descifrado. Dos capas, ambas en localStorage y
 * con espejo en memoria, scopeadas por la pubkey del usuario:
 *
 *  1. Hilo por contacto (`THREAD_PREFIX`): los últimos mensajes ya descifrados
 *     de cada conversación. Permite el primer render inmediato al abrir un chat.
 *  2. Descifrado por evento (`DEC_KEY`): mapa eventId→texto. Evita volver a
 *     descifrar (y, con NIP-07, volver a pedir permiso) los eventos ya vistos
 *     en cada refresco en segundo plano.
 *
 * Nota de privacidad: esto guarda DMs descifrados en el dispositivo. Es un
 * trade-off consciente por UX; el caché se borra al cerrar sesión
 * (`clearDmCache`) y queda scopeado por usuario para no mezclar cuentas.
 */

export type DmMessage = {
  id: string;
  fromMe: boolean;
  text: string;
  created_at: number;
  /** Link de sala si el mensaje es un reto/invitación NIP-17 (tag `url`). */
  gameUrl?: string;
};

const THREAD_PREFIX = "ln_dm_thread_";
const DEC_PREFIX = "ln_dm_dec_";

// Topes para no inflar localStorage indefinidamente.
const MAX_THREAD_MESSAGES = 300;
const MAX_DEC_ENTRIES = 4000;

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage lleno o bloqueado: el caché es best-effort */
  }
}

// --- Hilo por contacto ---

function threadKey(myPubkey: string, counterpart: string): string {
  return `${THREAD_PREFIX}${myPubkey}_${counterpart}`;
}

export function getCachedThread(
  myPubkey: string,
  counterpart: string,
): DmMessage[] | null {
  const raw = safeGet(threadKey(myPubkey, counterpart));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DmMessage[]) : null;
  } catch {
    return null;
  }
}

export function saveCachedThread(
  myPubkey: string,
  counterpart: string,
  messages: DmMessage[],
): void {
  const trimmed = messages.slice(-MAX_THREAD_MESSAGES);
  safeSet(threadKey(myPubkey, counterpart), JSON.stringify(trimmed));
}

// --- Descifrado por evento (espejo en memoria + persistencia) ---

const decKey = (myPubkey: string) => `${DEC_PREFIX}${myPubkey}`;

// Espejo en memoria por usuario para no parsear localStorage en cada lookup.
const decMemory = new Map<string, Map<string, string>>();

function decMap(myPubkey: string): Map<string, string> {
  let m = decMemory.get(myPubkey);
  if (m) return m;
  m = new Map();
  const raw = safeGet(decKey(myPubkey));
  if (raw) {
    try {
      const entries = JSON.parse(raw) as [string, string][];
      if (Array.isArray(entries)) {
        for (const [id, text] of entries) m.set(id, text);
      }
    } catch {
      /* corrupto: arrancamos vacío */
    }
  }
  decMemory.set(myPubkey, m);
  return m;
}

export function getCachedDecryption(
  myPubkey: string,
  eventId: string,
): string | undefined {
  return decMap(myPubkey).get(eventId);
}

/**
 * Guarda varios descifrados de una vez y persiste el mapa (recortado al tope
 * por las entradas más recientes). Recibe un lote para escribir localStorage una
 * sola vez por refresco en vez de una por mensaje.
 */
export function cacheDecryptions(
  myPubkey: string,
  entries: Array<{ id: string; text: string }>,
): void {
  if (entries.length === 0) return;
  const m = decMap(myPubkey);
  for (const { id, text } of entries) {
    // Re-set para mover la entrada al final (orden de inserción ≈ recencia).
    m.delete(id);
    m.set(id, text);
  }
  // Recorte: descartamos las más viejas (al frente del orden de inserción).
  while (m.size > MAX_DEC_ENTRIES) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
  safeSet(decKey(myPubkey), JSON.stringify([...m.entries()]));
}

// --- Limpieza (al cerrar sesión) ---

export function clearDmCache(): void {
  decMemory.clear();
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(THREAD_PREFIX) || k.startsWith(DEC_PREFIX))) {
        keys.push(k);
      }
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* localStorage bloqueado: nada que limpiar */
  }
}
