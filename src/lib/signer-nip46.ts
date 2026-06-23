/**
 * Conexión con firmantes remotos NIP-46 (Nostr Connect): Amber, nsec.app, etc.
 * Separado de `signer.ts` para cargarlo con `import()` dinámico solo cuando se
 * usa (el BunkerSigner abre su propio pool de relays).
 */

import { generateSecretKey, getPublicKey, nip04, nip19, nip44 } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import {
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
  type BunkerPointer,
} from "nostr-tools/nip46";
import type { LunaSigner, StoredSigner } from "./signer";

// Relays donde cliente y firmante se encuentran para el handshake NIP-46.
// Lideramos con relays grandes y abiertos (damus, nos.lol) que cualquier firmante
// genérico (Amber, Primal, nsec.app) alcanza y donde puede publicar la respuesta
// de `connect`. Dejamos relay.nsec.app al final para los usuarios de nsec.app.
export const NIP46_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nsec.app",
];

// Kinds que la app llega a firmar — DEBE reflejar SIGN_KINDS en nostr-social.ts:
// 1=comentarios/reseñas, 3=contactos NIP-02, 4=DM NIP-04, 27235=login,
// 30315=presencia NIP-38.
const NIP46_SIGN_KINDS = [1, 3, 4, 27235, 30315];

// Permisos que pre-solicitamos al firmante en el URI nostrconnect://. Clave para
// firmantes con confianza "media" (Primal): solo pre-autorizan EXACTAMENTE lo
// declarado, y `sign_event` genérico no les alcanza para firmar un kind puntual
// como el 27235 del login → se traba. Por eso pedimos el método genérico Y cada
// kind por separado (Amber/nsec.app entienden ambos; Primal-medium necesita el
// `sign_event:<kind>`). Con esto el challenge de login se firma sin prompt.
const NIP46_PERMS = [
  "get_public_key",
  "sign_event",
  ...NIP46_SIGN_KINDS.map((k) => `sign_event:${k}`),
  "nip04_encrypt",
  "nip04_decrypt",
];

function wrap(signer: BunkerSigner): LunaSigner {
  return {
    method: "nip46",
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (e) => signer.signEvent(e),
    nip04Encrypt: (peer, plaintext) => signer.nip04Encrypt(peer, plaintext),
    nip04Decrypt: (peer, ciphertext) => signer.nip04Decrypt(peer, ciphertext),
    close: () => signer.close(),
  };
}

/** Para persistir la sesión: la clave efímera del cliente + el bunker pointer. */
export function storedNip46(
  clientSecretKey: Uint8Array,
  bp: BunkerPointer,
): StoredSigner {
  return {
    method: "nip46",
    clientNsec: nip19.nsecEncode(clientSecretKey),
    bunker: { relays: bp.relays, pubkey: bp.pubkey, secret: bp.secret },
  };
}

/**
 * Conecta con un bunker a partir de un `bunker://...` o un identificador
 * NIP-05 (`usuario@dominio`). `onauth` recibe la URL de autorización si el
 * bunker la pide (se muestra como link al usuario).
 */
export async function connectBunker(
  input: string,
  onauth?: (url: string) => void,
): Promise<{ signer: LunaSigner; stored: StoredSigner }> {
  const bp = await parseBunkerInput(input.trim());
  if (!bp) {
    throw new Error("No es un bunker:// ni un identificador NIP-05 válido");
  }
  const clientSecretKey = generateSecretKey();
  const bunker = BunkerSigner.fromBunker(clientSecretKey, bp, { onauth });
  await bunker.connect();
  return { signer: wrap(bunker), stored: storedNip46(clientSecretKey, bp) };
}

/**
 * Inicia el flujo Nostr Connect por QR: genera el URI `nostrconnect://` para
 * escanear con Amber/nsec.app y devuelve la promesa que resuelve cuando el
 * firmante remoto se conecta.
 */
// kind 24133 = NIP-46 Nostr Connect.
const NOSTR_CONNECT_KIND = 24133;

/** Nombre corto de un relay para los logs de diagnóstico. */
function rname(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

export function startNostrConnect(opts?: {
  onauth?: (url: string) => void;
  signal?: AbortSignal;
  /** Diagnóstico: recibe líneas de estado del handshake (relays, eventos, descifrado). */
  onDebug?: (line: string) => void;
}): {
  uri: string;
  established: Promise<{ signer: LunaSigner; stored: StoredSigner }>;
} {
  const dbg = opts?.onDebug ?? (() => {});
  const clientSecretKey = generateSecretKey();
  const clientPubkey = getPublicKey(clientSecretKey);
  const secret = crypto.randomUUID().replace(/-/g, "");
  const uri = createNostrConnectURI({
    clientPubkey,
    relays: NIP46_RELAYS,
    secret,
    perms: NIP46_PERMS,
    name: "Luna Negra",
    url: typeof window !== "undefined" ? window.location.origin : undefined,
  });
  // Pool propio con reconexión: clave para el login en CELULAR. Al abrir el
  // firmante (Primal/Amber) por deep link, el navegador pasa a segundo plano y
  // el SO cierra el WebSocket. Sin reconexión, `fromURI` cierra la suscripción y
  // RECHAZA la promesa ("subscription closed before connection was established")
  // antes de que el firmante publique su respuesta → al volver, la sesión nunca
  // entra. Con `enableReconnect`, la caída del socket reconecta sin matar el
  // flujo, así la respuesta `connect` se recibe al regresar al navegador.
  const pool = new SimplePool({ enableReconnect: true });
  // El callback se dispara una vez por suscripción; deduplicamos por relay para
  // no llenar el panel con líneas repetidas.
  const seenRelays = new Set<string>();
  pool.onRelayConnectionSuccess = (url: string) => {
    if (seenRelays.has(url)) return;
    seenRelays.add(url);
    dbg(`relay conectado: ${rname(url)}`);
  };
  pool.onRelayConnectionFailure = (url: string) => dbg(`relay FALLÓ: ${rname(url)}`);

  // Observador de diagnóstico EN PARALELO al flujo de nostr-tools. nostr-tools
  // suscribe con `limit:0` (solo eventos en vivo); nosotros usamos `since` para
  // tambien captar el evento si el relay lo retuvo, y reportamos qué llega y si
  // se puede descifrar (NIP-44 vs NIP-04) y si el secreto coincide. Es temporal:
  // sirve para entender por qué Primal "aprueba y no pasa nada".
  const sinceSec = Math.floor(Date.now() / 1000) - 300;
  const observer = pool.subscribe(
    NIP46_RELAYS,
    { kinds: [NOSTR_CONNECT_KIND], "#p": [clientPubkey], since: sinceSec },
    {
      onevent: (event: { pubkey: string; content: string }) => {
        const from = event.pubkey.slice(0, 8);
        let decoded: string | null = null;
        let how = "";
        try {
          const ck = nip44.getConversationKey(clientSecretKey, event.pubkey);
          decoded = nip44.decrypt(event.content, ck);
          how = "NIP-44";
        } catch {
          try {
            decoded = nip04.decrypt(clientSecretKey, event.pubkey, event.content);
            how = "NIP-04 (¡el firmante usa cifrado viejo!)";
          } catch {
            decoded = null;
          }
        }
        if (!decoded) {
          dbg(`evento de ${from}: NO se pudo descifrar (ni NIP-44 ni NIP-04)`);
          return;
        }
        let result = "";
        try {
          result = JSON.parse(decoded).result ?? "";
        } catch {
          result = decoded.slice(0, 24);
        }
        const matchTxt = result === secret ? "secreto OK ✓" : `secreto NO coincide (got "${String(result).slice(0, 12)}…")`;
        dbg(`evento de ${from} descifrado con ${how}; ${matchTxt}`);
      },
    },
  );
  const stopObserver = () => {
    try {
      void observer.close?.();
    } catch {
      /* noop */
    }
  };

  // Si se cancela (cerrar modal / cambiar de pestaña) liberamos el pool para que
  // no quede reconectando en segundo plano para siempre.
  opts?.signal?.addEventListener(
    "abort",
    () => {
      stopObserver();
      pool.destroy();
    },
    { once: true },
  );
  dbg("esperando respuesta del firmante…");
  const established = BunkerSigner.fromURI(
    clientSecretKey,
    uri,
    { onauth: opts?.onauth, pool },
    opts?.signal ?? 120_000,
  ).then((bunker) => {
    stopObserver();
    dbg("¡conectado! iniciando sesión…");
    const signer = wrap(bunker);
    const close = signer.close;
    // Al cerrar la sesión, además de cerrar el firmante, destruimos el pool.
    signer.close = async () => {
      try {
        await close?.();
      } finally {
        pool.destroy();
      }
    };
    return { signer, stored: storedNip46(clientSecretKey, bunker.bp) };
  });
  return { uri, established };
}

/** Reconecta un bunker persistido (al restaurar la sesión). */
export async function restoreBunkerSigner(
  clientNsec: string,
  bunker: { relays: string[]; pubkey: string; secret: string | null },
): Promise<LunaSigner> {
  const decoded = nip19.decode(clientNsec);
  if (decoded.type !== "nsec") throw new Error("clave de cliente inválida");
  const signer = BunkerSigner.fromBunker(decoded.data, bunker);
  await signer.connect();
  return wrap(signer);
}
