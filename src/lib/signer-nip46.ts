/**
 * Conexión con firmantes remotos NIP-46 (Nostr Connect): Amber, nsec.app, etc.
 * Separado de `signer.ts` para cargarlo con `import()` dinámico solo cuando se
 * usa (el BunkerSigner abre su propio pool de relays).
 */

import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
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

// Permisos que pre-solicitamos al firmante en el URI nostrconnect:// para que
// sepa qué le pedimos y pueda autorizarlos de una (login + firmar eventos +
// cifrar/descifrar DMs NIP-04). Sin esto algunos firmantes ni muestran el prompt.
const NIP46_PERMS = [
  "get_public_key",
  "sign_event",
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
export function startNostrConnect(opts?: {
  onauth?: (url: string) => void;
  signal?: AbortSignal;
}): {
  uri: string;
  established: Promise<{ signer: LunaSigner; stored: StoredSigner }>;
} {
  const clientSecretKey = generateSecretKey();
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(clientSecretKey),
    relays: NIP46_RELAYS,
    secret: crypto.randomUUID().replace(/-/g, ""),
    perms: NIP46_PERMS,
    name: "Luna Negra",
    url: typeof window !== "undefined" ? window.location.origin : undefined,
  });
  const established = BunkerSigner.fromURI(
    clientSecretKey,
    uri,
    { onauth: opts?.onauth },
    opts?.signal ?? 120_000,
  ).then((bunker) => ({
    signer: wrap(bunker),
    stored: storedNip46(clientSecretKey, bunker.bp),
  }));
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
