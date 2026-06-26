import { getEventHash, finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { SimplePool, nip44, verifyEvent, type Event } from "nostr-tools";
import { RELAYS } from "./constants";
import { getActiveSigner, type LunaSigner, type UnsignedEvent } from "./signer";

/**
 * Reto 1v1 por DM cifrado (interfaz 2.0, nivel M0). Un jugador "reta" a otro a
 * jugar un juego: se firma una invitación NIP-17 (gift-wrap) y se publica a los
 * relays. Va **cifrada al destinatario** → el server de Luna Negra NO la puede
 * leer; es íntegramente cliente-a-cliente. Desacoplada de las salas: la
 * invitación solo APUNTA (juego + opcionalmente una sala), no lleva token.
 *
 * Es estándar NIP-17, así que cualquier cliente Nostr compatible (p. ej.
 * futbolcillo) puede recibirla. Ver docs/perfil-juego-nostr-salas-invitaciones.md.
 *
 * Necesita un signer con NIP-44 (extensión NIP-07 moderna o clave local). NIP-46
 * todavía no expone NIP-44 acá → `sendChallenge`/`fetchChallenges` lanzan claro.
 */

export const CHALLENGE_RUMOR_KIND = 14; // mensaje de chat NIP-17 (rumor interno)
const SEAL_KIND = 13;
const GIFT_WRAP_KIND = 1059;
// NIP-59: los timestamps se ofuscan hasta 2 días en el pasado (anti-correlación).
const MAX_JITTER_S = 2 * 24 * 60 * 60;

const now = () => Math.floor(Date.now() / 1000);
const jitteredTs = () => now() - Math.floor(Math.random() * MAX_JITTER_S);

export type ChallengeInput = {
  game: string; // coordenada del juego (30023:<tienda>:<slug>)
  room?: string; // groupId de sala NIP-29 opcional
  roomRelay?: string; // hint de relay de la sala
  url?: string; // deep link opcional para lanzar
  message?: string; // texto humano
  expiresAt?: number; // unix; cuándo caduca el reto
};

export type Challenge = ChallengeInput & {
  from: string; // pubkey del retador (verificado contra la firma del seal)
  message: string;
  wrapId: string; // id del gift-wrap (dedup)
};

/**
 * Cripto mínima que NIP-17 necesita para sellar/abrir. La implementan tanto una
 * clave cruda (tests) como el `LunaSigner` del cliente (vía NIP-44).
 */
export interface ChallengeCrypto {
  pubkey: string;
  signEvent(e: UnsignedEvent): Promise<Event>;
  nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string>;
}

// --- Construcción (gift-wrap NIP-17, manual para soportar signers sin clave) ---

function buildRumor(senderPubkey: string, recipient: string, input: ChallengeInput) {
  const tags: string[][] = [
    ["p", recipient],
    ["game", input.game],
  ];
  if (input.room) tags.push(["room", input.room, ...(input.roomRelay ? [input.roomRelay] : [])]);
  if (input.url) tags.push(["url", input.url]);
  if (input.expiresAt) tags.push(["expiration", String(input.expiresAt)]);

  const rumor = {
    kind: CHALLENGE_RUMOR_KIND,
    pubkey: senderPubkey,
    created_at: now(),
    tags,
    content: input.message ?? "",
  };
  // El rumor va SIN firmar (NIP-59) pero con su id calculado.
  return { ...rumor, id: getEventHash(rumor) };
}

/**
 * Construye el gift-wrap (kind:1059) firmado para `recipient`. El seal (kind:13)
 * lo firma el retador (prueba de autoría); el wrap lo firma una clave efímera
 * descartable (anti-correlación). Estándar NIP-17.
 */
export async function buildChallengeWrap(
  crypto: ChallengeCrypto,
  recipient: string,
  input: ChallengeInput,
): Promise<Event> {
  const rumor = buildRumor(crypto.pubkey, recipient, input);
  const seal = await crypto.signEvent({
    kind: SEAL_KIND,
    created_at: jitteredTs(),
    tags: [],
    content: await crypto.nip44Encrypt(recipient, JSON.stringify(rumor)),
  });

  const ephemeral = generateSecretKey();
  const convKey = nip44.getConversationKey(ephemeral, recipient);
  return finalizeEvent(
    {
      kind: GIFT_WRAP_KIND,
      created_at: jitteredTs(),
      tags: [["p", recipient]],
      content: nip44.encrypt(JSON.stringify(seal), convKey),
    },
    ephemeral,
  );
}

/** Abre un gift-wrap dirigido a mí y devuelve el reto, o null si no es válido. */
export async function unwrapChallenge(
  crypto: ChallengeCrypto,
  wrap: Event,
): Promise<Challenge | null> {
  if (wrap.kind !== GIFT_WRAP_KIND) return null;

  let seal: Event;
  try {
    seal = JSON.parse(await crypto.nip44Decrypt(wrap.pubkey, wrap.content)) as Event;
  } catch {
    return null;
  }
  // El seal tiene que estar firmado de verdad por quien dice ser (anti-forja).
  if (seal.kind !== SEAL_KIND || !verifyEvent(seal)) return null;

  let rumor: { pubkey: string; tags: string[][]; content: string };
  try {
    rumor = JSON.parse(await crypto.nip44Decrypt(seal.pubkey, seal.content));
  } catch {
    return null;
  }
  // Anti-spoof: el autor declarado del rumor debe ser quien firmó el seal.
  if (rumor.pubkey !== seal.pubkey) return null;

  return parseChallengeFromRumor(rumor, seal.pubkey, wrap.id);
}

function tagVal(tags: string[][], k: string) {
  return tags.find((t) => t[0] === k)?.[1];
}

/** Extrae el reto del rumor descifrado. Requiere tag `game` (si no, no es un reto). */
export function parseChallengeFromRumor(
  rumor: { tags: string[][]; content: string },
  from: string,
  wrapId: string,
): Challenge | null {
  const game = tagVal(rumor.tags, "game");
  if (!game) return null;
  const roomTag = rumor.tags.find((t) => t[0] === "room");
  const expRaw = tagVal(rumor.tags, "expiration");
  return {
    from,
    game,
    room: roomTag?.[1],
    roomRelay: roomTag?.[2],
    url: tagVal(rumor.tags, "url"),
    message: rumor.content ?? "",
    expiresAt: expRaw ? Number(expRaw) : undefined,
    wrapId,
  };
}

// --- Puente con el LunaSigner del cliente ---

export function signerToCrypto(signer: LunaSigner): ChallengeCrypto {
  if (!signer.nip44Encrypt || !signer.nip44Decrypt) {
    throw new Error("Tu método de login no soporta NIP-44 (necesario para retos cifrados)");
  }
  const enc = signer.nip44Encrypt.bind(signer);
  const dec = signer.nip44Decrypt.bind(signer);
  return {
    // pubkey se resuelve perezosamente al firmar; acá lo dejamos vacío y lo
    // completamos en sendChallenge (donde ya lo tenemos).
    pubkey: "",
    signEvent: (e) => signer.signEvent(e),
    nip44Encrypt: enc,
    nip44Decrypt: dec,
  };
}

let _pool: SimplePool | null = null;
function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool();
  return _pool;
}

/** Envía un reto al `recipient` (pubkey hex) usando el signer activo del cliente. */
export async function sendChallenge(
  recipient: string,
  input: ChallengeInput,
): Promise<void> {
  const signer = getActiveSigner();
  if (!signer) throw new Error("No hay sesión Nostr activa");
  const crypto = signerToCrypto(signer);
  crypto.pubkey = await signer.getPublicKey();
  const wrap = await buildChallengeWrap(crypto, recipient, input);
  await Promise.any(pool().publish(RELAYS, wrap)).catch(() => {
    throw new Error("Ningún relay aceptó el reto");
  });
}

/** Lee los retos entrantes (gift-wraps dirigidos a mí), los abre y deduplica. */
export async function fetchChallenges(myPubkey: string): Promise<Challenge[]> {
  const signer = getActiveSigner();
  if (!signer) throw new Error("No hay sesión Nostr activa");
  const crypto = signerToCrypto(signer);
  crypto.pubkey = myPubkey;

  const wraps = await pool().querySync(
    RELAYS,
    { kinds: [GIFT_WRAP_KIND], "#p": [myPubkey] },
    { maxWait: 5000 },
  );

  const out = new Map<string, Challenge>();
  const nowS = now();
  for (const wrap of wraps) {
    const ch = await unwrapChallenge(crypto, wrap).catch(() => null);
    if (!ch) continue; // no es un reto (otro tipo de DM NIP-17) o inválido
    if (ch.expiresAt && ch.expiresAt < nowS) continue; // caducado
    out.set(ch.wrapId, ch);
  }
  return [...out.values()];
}
