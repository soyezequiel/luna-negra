import { verifyEvent, type Event } from "nostr-tools";
import { createHash } from "crypto";

const KIND = 27235; // NIP-98 HTTP Auth
const MAX_AGE = 60; // segundos

/**
 * Verifica un header `Authorization: Nostr <base64(evento)>` (NIP-98).
 * Devuelve el pubkey del firmante si es válido, o null.
 * Liga el evento al body via el tag `payload` = sha256(body) (anti-replay/tampering).
 */
export function verifyNip98(
  authHeader: string | null,
  method: string,
  bodyText: string,
): string | null {
  if (!authHeader || !authHeader.startsWith("Nostr ")) return null;

  let ev: Event;
  try {
    ev = JSON.parse(
      Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8"),
    );
  } catch {
    return null;
  }

  if (ev.kind !== KIND) return null;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ev.created_at) > MAX_AGE) return null;

  const m = ev.tags?.find((t) => t[0] === "method")?.[1];
  if (m?.toUpperCase() !== method.toUpperCase()) return null;

  if (bodyText) {
    const hash = createHash("sha256").update(bodyText).digest("hex");
    const payloadTag = ev.tags?.find((t) => t[0] === "payload")?.[1];
    if (payloadTag !== hash) return null;
  }

  if (!verifyEvent(ev)) return null;
  return ev.pubkey;
}
