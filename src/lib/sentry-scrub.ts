/**
 * Saneo de eventos antes de mandarlos a Sentry.
 *
 * Luna Negra maneja secretos que mueven dinero (NWC, nsec del server, JWT de
 * sesión, signing keys de QStash). Aunque `sendDefaultPii: false` ya evita IP y
 * cookies, acá hacemos una pasada extra: borramos el valor de claves sensibles y
 * redactamos cualquier string que matchee un patrón de secreto, en TODO el evento.
 * Es defensa en profundidad: si por error un secreto llega a un mensaje o stack,
 * no sale del proceso.
 */

const REDACTED = "[REDACTED]";

// Patrones de secretos que NUNCA deben salir hacia Sentry.
const SECRET_PATTERNS: RegExp[] = [
  /nsec1[a-z0-9]{20,}/gi, // claves privadas Nostr (bech32)
  /nostr\+walletconnect:\/\/[^\s"'<>]+/gi, // cadena NWC (controla el wallet)
  /\bsig_[A-Za-z0-9]{8,}/g, // signing keys de QStash
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT (header.payload.firma)
];

// Claves cuyo valor se redacta entero, sin importar el contenido.
const SENSITIVE_KEYS = new Set([
  "cookie",
  "cookies",
  "authorization",
  "set-cookie",
  "token",
  "secret",
  "password",
  "nwc_connection_string",
  "jwt_secret",
  "luna_negra_nsec",
  "qstash_current_signing_key",
  "qstash_next_signing_key",
]);

function redactString(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 12) return value; // cota de seguridad anti-recursión infinita
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase())
        ? REDACTED
        : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redacta secretos de un evento de Sentry (errores o transacciones). */
export function scrubEvent<T>(event: T): T {
  try {
    return scrub(event) as T;
  } catch {
    return event; // ante cualquier problema, no romper el envío
  }
}
