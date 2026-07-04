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
 * aunque algún relay todavía sirva la versión anterior.
 *
 * `maxWaitMs` acota la espera del EOSE por relay (querySync espera a TODOS los
 * relays; sin tope, uno lento/colgado retiene la respuesta ~4,4s — el default del
 * pool). Lo usan los caminos sensibles a latencia (payout de apuestas): con menos
 * relays respondiendo el perfil puede ser algo más viejo, pero el caller tiene
 * fallback (User.lud16) y la plata no queda rehén del relay más lento. */
export async function fetchProfile(
  pubkey: string,
  opts?: { maxWaitMs?: number },
): Promise<NostrProfile | null> {
  try {
    const evs = await getPool().querySync(
      RELAYS,
      {
        kinds: [0],
        authors: [pubkey],
      },
      opts?.maxWaitMs ? { maxWait: opts.maxWaitMs } : undefined,
    );
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
