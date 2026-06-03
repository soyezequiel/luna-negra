import { finalizeEvent } from "nostr-tools/pure";
import { SimplePool, nip19, type Event } from "nostr-tools";
import { RELAYS } from "./constants";

// Identidad Nostr de Luna Negra (server) para firmar el contrato.
function getSecretKey(): Uint8Array | null {
  const s = process.env.LUNA_NEGRA_NSEC;
  if (!s) return null;
  try {
    if (s.startsWith("nsec")) {
      const d = nip19.decode(s);
      return d.data as Uint8Array;
    }
    return Uint8Array.from(Buffer.from(s, "hex"));
  } catch {
    return null;
  }
}

let pool: SimplePool | null = null;
function getPool(): SimplePool {
  if (!pool) pool = new SimplePool();
  return pool;
}

/**
 * Firma y publica el contrato de la apuesta como nota Nostr (kind:1, inmutable).
 * Devuelve el event id, o null si no hay clave configurada (best-effort).
 */
export async function publishContract(
  content: string,
  tags: string[][],
): Promise<string | null> {
  const sk = getSecretKey();
  if (!sk) return null;
  const ev = finalizeEvent(
    { kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content },
    sk,
  );
  try {
    await Promise.allSettled(getPool().publish(RELAYS, ev));
  } catch {
    /* best-effort: el id ya está calculado */
  }
  return ev.id;
}

/** Republica un evento ya firmado (ej. el resultado firmado por el proveedor). */
export async function publishSignedEvent(ev: Event): Promise<void> {
  try {
    await Promise.allSettled(getPool().publish(RELAYS, ev));
  } catch {
    /* best-effort */
  }
}
