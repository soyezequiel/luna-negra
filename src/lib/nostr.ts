import { SimplePool } from "nostr-tools";
import { RELAYS } from "./constants";

export type NostrProfile = {
  name?: string;
  display_name?: string;
  displayName?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  lud16?: string; // Lightning Address
};

let pool: SimplePool | null = null;
function getPool(): SimplePool {
  if (!pool) pool = new SimplePool();
  return pool;
}

/** Lee el metadata (kind:0) de un usuario desde relays públicos.
 *
 * El kind:0 es un evento reemplazable: cada relay puede tener una versión
 * distinta. Por eso no usamos `pool.get()` (que devuelve el primer evento que
 * responda, posiblemente viejo), sino que consultamos todos los relays con
 * `querySync` y nos quedamos con el de `created_at` más alto (el más reciente).
 * Así reflejamos cambios de nombre/avatar hechos en otros clientes (Primal, etc.)
 * aunque algún relay todavía sirva la versión anterior. */
export async function fetchProfile(
  pubkey: string,
): Promise<NostrProfile | null> {
  try {
    const evs = await getPool().querySync(RELAYS, {
      kinds: [0],
      authors: [pubkey],
    });
    if (evs.length === 0) return null;
    const newest = evs.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    return JSON.parse(newest.content) as NostrProfile;
  } catch {
    return null;
  }
}

export function profileName(p: NostrProfile | null): string | null {
  return p?.displayName || p?.display_name || p?.name || null;
}
