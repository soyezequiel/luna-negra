/**
 * Abstracción de firma Nostr de Luna Negra. Antes todo pasaba por `window.nostr`
 * (NIP-07); ahora la app habla con un `LunaSigner` activo que puede ser:
 *  - "nip07": extensión del navegador (nos2x, Alby) — como siempre.
 *  - "nip46": firmante remoto Nostr Connect (Amber, nsec.app) vía bunker.
 *  - "local": clave en este navegador (generada o nsec importado), como figus.
 *
 * Módulo client-only: no toca `window`/`localStorage` a nivel de módulo porque
 * `nostr-social.ts` (que lo importa) también se carga en el server.
 */

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip04,
  nip44,
  nip19,
  type Event,
} from "nostr-tools";
import type { BalIdentitySource } from "nostr-game-protocol/bal";

export type SignerMethod = "nip07" | "nip46" | "local";
export type LocalSignerSource = "imported" | "generated" | "custodial";

export type UnsignedEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export interface LunaSigner {
  readonly method: SignerMethod;
  getPublicKey(): Promise<string>;
  signEvent(e: UnsignedEvent): Promise<Event>;
  nip04Encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt(peerPubkey: string, ciphertext: string): Promise<string>;
  /**
   * NIP-44 (cifrado moderno; lo necesita NIP-17 para los retos cifrados).
   * Opcional: nip07 y local lo soportan; nip46 todavía no lo expone acá.
   */
  nip44Encrypt?(peerPubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt?(peerPubkey: string, ciphertext: string): Promise<string>;
  /** Libera recursos (pool del bunker NIP-46). */
  close?(): Promise<void>;
}

// --- Persistencia de la sesión de signer (localStorage, JSON discriminado) ---

export const SIGNER_STORAGE_KEY = "ln_signer";

export type StoredSigner =
  | { method: "nip07" }
  | {
      method: "local";
      nsec: string;
      /** Procedencia para UX/políticas; ausente = clave local de una sesión legacy. */
      source?: LocalSignerSource;
    }
  | {
      method: "nip46";
      clientNsec: string;
      bunker: {
        relays: string[];
        pubkey: string;
        secret: string | null;
        // Cifrado detectado en el handshake (NIP-44 vs NIP-04). Si falta, es una
        // sesión vieja anterior a la detección → se restaura con el cliente
        // legacy (BunkerSigner, solo NIP-44).
        encryption?: "nip44" | "nip04";
      };
    };

/** Metadata no secreta que puede persistir entre recargas. */
type PersistedSigner =
  | { method: "nip07" }
  | { method: "local"; source?: LocalSignerSource; transient: true }
  | { method: "nip46"; transient: true };

function readStoredSigner(): PersistedSigner | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SIGNER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.method === "nip07") return { method: "nip07" };
    if (parsed.method === "local") {
      const source =
        parsed.source === "imported" ||
        parsed.source === "generated" ||
        parsed.source === "custodial"
          ? parsed.source
          : undefined;
      // Migra sesiones antiguas eliminando cualquier nsec en texto plano.
      if (typeof parsed.nsec === "string") {
        localStorage.setItem(
          SIGNER_STORAGE_KEY,
          JSON.stringify({ method: "local", source, transient: true }),
        );
      }
      return { method: "local", source, transient: true };
    }
    if (parsed.method === "nip46") {
      // La clave cliente del bunker tampoco debe quedar en localStorage.
      if (typeof parsed.clientNsec === "string") {
        localStorage.setItem(
          SIGNER_STORAGE_KEY,
          JSON.stringify({ method: "nip46", transient: true }),
        );
      }
      return { method: "nip46", transient: true };
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredSigner(stored: StoredSigner | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!stored) {
      localStorage.removeItem(SIGNER_STORAGE_KEY);
    } else if (stored.method === "nip07") {
      localStorage.setItem(SIGNER_STORAGE_KEY, JSON.stringify(stored));
    } else if (stored.method === "local") {
      localStorage.setItem(
        SIGNER_STORAGE_KEY,
        JSON.stringify({
          method: "local",
          source: stored.source,
          transient: true,
        } satisfies PersistedSigner),
      );
    } else {
      localStorage.setItem(
        SIGNER_STORAGE_KEY,
        JSON.stringify({ method: "nip46", transient: true } satisfies PersistedSigner),
      );
    }
  } catch {
    /* storage bloqueado: la sesión de signer no persiste */
  }
}

// --- Signer activo (singleton en memoria) ---

let active: LunaSigner | null = null;
let restoring: Promise<LunaSigner | null> | null = null;
let signerGeneration = 0;

export function getActiveSigner(): LunaSigner | null {
  return active;
}

export function getStoredSignerMethod(): SignerMethod | null {
  return readStoredSigner()?.method ?? null;
}

/** Metadato local persistido; permite preparar UX antes de restaurar el signer. */
export function getStoredLocalSignerSource(): LocalSignerSource | null {
  const stored = readStoredSigner();
  return stored?.method === "local" ? stored.source ?? null : null;
}

/** Metadato no secreto de la clave local activa. Nunca expone la nsec. */
export function getActiveLocalSignerSource(): "imported" | "generated" | "custodial" | null {
  if (active?.method !== "local") return null;
  return getStoredLocalSignerSource();
}

/** Fuente BAL real: nunca presenta un complemento como si fuera una nsec local. */
export function resolveBalIdentitySource({
  custodial,
  signerMethod,
  localSource,
}: {
  custodial: boolean;
  signerMethod: SignerMethod | null;
  localSource: LocalSignerSource | null;
}): BalIdentitySource | null {
  if (signerMethod === "nip07") return "nip07";
  if (signerMethod !== "local") return null;
  if (localSource === "imported") return "nsec";
  if (localSource === "generated") return "nsec";
  if (custodial && localSource === "custodial") return "email";
  // Antes de guardar `source`, Luna persistía toda clave local sólo como
  // `{ method: "local", nsec }`. Si la cuenta coincide con esa clave (lo valida
  // `matchSignerToSessionUser`), sigue siendo una identidad BAL segura.
  if (localSource === null) return custodial ? "email" : "nsec";
  return null;
}

/**
 * Une la cuenta de Luna con el signer real. Si el estado React quedó viejo
 * (otra pestaña, HMR o una respuesta tardía), relee la sesión antes de fallar.
 */
export async function matchSignerToSessionUser<T extends { pubkey: string }>({
  signer,
  user,
  refreshUser,
}: {
  signer: LunaSigner;
  user: T | null;
  refreshUser: () => Promise<T | null>;
}): Promise<{ user: T; pubkey: string } | null> {
  const pubkey = (await signer.getPublicKey()).trim().toLowerCase();
  const matches = (candidate: T | null) => candidate?.pubkey.trim().toLowerCase() === pubkey;
  if (matches(user)) return { user: user!, pubkey };
  const refreshed = await refreshUser();
  return matches(refreshed) ? { user: refreshed!, pubkey } : null;
}

export function setActiveSigner(signer: LunaSigner, stored: StoredSigner): void {
  signerGeneration += 1;
  active = signer;
  writeStoredSigner(stored);
}

export function clearActiveSigner(): void {
  // Invalida también una restauración que todavía esté esperando que aparezca
  // NIP-07 o que termine de reconectar un bunker. Así un logout no puede ser
  // revertido por una promesa vieja que resuelva unos milisegundos después.
  signerGeneration += 1;
  const prev = active;
  active = null;
  writeStoredSigner(null);
  void prev?.close?.();
}

/** Las extensiones NIP-07 suelen inyectar `window.nostr` después de hidratar. */
async function waitForNip07(timeoutMs = 5000): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const started = Date.now();
  while (!window.nostr && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return Boolean(window.nostr);
}

/**
 * Restaura el signer guardado al montar la app (la cookie de sesión vive 30
 * días; sin esto, comentar/chatear tras volver fallaría hasta re-loguear).
 * Para NIP-46 difiere la conexión real al primer uso (import dinámico).
 */
async function restoreStoredSigner(): Promise<LunaSigner | null> {
  const generation = signerGeneration;
  const stored = readStoredSigner();
  let candidate: LunaSigner | null = null;

  if (!stored) {
    // Compat: sesiones previas a la abstracción eran siempre NIP-07.
    if (await waitForNip07()) {
      candidate = createNip07Signer();
      // Migra la sesión legacy para que la intención de restaurar quede explícita.
      if (generation === signerGeneration) writeStoredSigner({ method: "nip07" });
    }
  } else try {
    if (stored.method === "nip07") {
      if (!(await waitForNip07())) return null;
      candidate = createNip07Signer();
    } else if (stored.method === "local") {
      // Las claves importadas o temporales viven sólo en memoria. Una cuenta por
      // email puede recuperar su signer custodial mediante la sesión httpOnly.
      if (stored.source !== "custodial") return null;
      const response = await fetch("/api/users/me/nsec", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { nsec?: string };
      if (!response.ok || !data.nsec) return null;
      candidate = importNsec(data.nsec);
    } else {
      // Nostr Connect usa una clave cliente temporal que no se persiste.
      return null;
    }
  } catch {
    return null;
  }

  if (!candidate) return null;
  if (generation !== signerGeneration) {
    void candidate.close?.();
    return active;
  }
  active = candidate;
  return active;
}

/**
 * Restaura una sola vez aunque SessionProvider, BAL y una acción social la pidan
 * al mismo tiempo. Esto evita abrir varios clientes NIP-46 para la misma sesión.
 */
export function restoreSigner(): Promise<LunaSigner | null> {
  if (active) return Promise.resolve(active);
  if (restoring) return restoring;
  restoring = restoreStoredSigner().finally(() => {
    restoring = null;
  });
  return restoring;
}

// --- NIP-07 (extensión) ---

export function createNip07Signer(): LunaSigner {
  const nostr = () => {
    if (typeof window === "undefined" || !window.nostr) {
      throw new Error("Necesitás una extensión Nostr (nos2x/Alby)");
    }
    return window.nostr;
  };
  return {
    method: "nip07",
    getPublicKey: () => nostr().getPublicKey(),
    signEvent: async (e) =>
      (await nostr().signEvent(e)) as unknown as Event,
    nip04Encrypt: (peer, plaintext) => {
      const n = nostr();
      if (!n.nip04) throw new Error("Tu extensión no soporta NIP-04");
      return n.nip04.encrypt(peer, plaintext);
    },
    nip04Decrypt: (peer, ciphertext) => {
      const n = nostr();
      if (!n.nip04) throw new Error("Tu extensión no soporta NIP-04");
      return n.nip04.decrypt(peer, ciphertext);
    },
    nip44Encrypt: (peer, plaintext) => {
      const n = nostr();
      if (!n.nip44) throw new Error("Tu extensión no soporta NIP-44");
      return n.nip44.encrypt(peer, plaintext);
    },
    nip44Decrypt: (peer, ciphertext) => {
      const n = nostr();
      if (!n.nip44) throw new Error("Tu extensión no soporta NIP-44");
      return n.nip44.decrypt(peer, ciphertext);
    },
  };
}

// --- Clave local (generada o nsec importado; guardada plana como figus) ---

export function createLocalSigner(secretKey: Uint8Array): LunaSigner {
  const pubkey = getPublicKey(secretKey);
  return {
    method: "local",
    getPublicKey: async () => pubkey,
    signEvent: async (e) => finalizeEvent(e, secretKey),
    nip04Encrypt: async (peer, plaintext) =>
      nip04.encrypt(secretKey, peer, plaintext),
    nip04Decrypt: async (peer, ciphertext) =>
      nip04.decrypt(secretKey, peer, ciphertext),
    nip44Encrypt: async (peer, plaintext) =>
      nip44.encrypt(plaintext, nip44.getConversationKey(secretKey, peer)),
    nip44Decrypt: async (peer, ciphertext) =>
      nip44.decrypt(ciphertext, nip44.getConversationKey(secretKey, peer)),
  };
}

export function generateLocalSigner(): { signer: LunaSigner; nsec: string } {
  const sk = generateSecretKey();
  return { signer: createLocalSigner(sk), nsec: nip19.nsecEncode(sk) };
}

/** Valida y decodifica un nsec; lanza con mensaje claro si no lo es. */
export function importNsec(nsec: string): LunaSigner {
  let decoded: ReturnType<typeof nip19.decode>;
  try {
    decoded = nip19.decode(nsec.trim());
  } catch {
    throw new Error("Eso no parece un nsec válido");
  }
  if (decoded.type !== "nsec") {
    throw new Error("Eso no es una clave privada (nsec)");
  }
  return createLocalSigner(decoded.data);
}
