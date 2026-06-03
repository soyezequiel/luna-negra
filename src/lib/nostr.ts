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

/** Lee el metadata (kind:0) de un usuario desde relays públicos. */
export async function fetchProfile(
  pubkey: string,
): Promise<NostrProfile | null> {
  try {
    const ev = await getPool().get(RELAYS, { kinds: [0], authors: [pubkey] });
    if (!ev) return null;
    return JSON.parse(ev.content) as NostrProfile;
  } catch {
    return null;
  }
}

export function profileName(p: NostrProfile | null): string | null {
  return p?.displayName || p?.display_name || p?.name || null;
}
