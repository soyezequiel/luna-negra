import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { SimplePool, nip19, type Event } from "nostr-tools";
import { RELAYS, gameTag } from "./constants";
import { buildResultEventTemplate } from "./escrow";
import {
  buildGameArticleTemplate,
  gameArticleCoord,
  type GameArticleInput,
} from "./game-article";

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

/**
 * Pubkey (hex) de la tienda, derivado de `LUNA_NEGRA_NSEC`. Es el firmante de los
 * artículos de juego y, por ende, parte de la coordenada `30023:<pubkey>:<slug>`.
 * Lo usa game-sync.ts para levantar los artículos por `authors`. Null si no hay
 * clave configurada.
 */
export function getStorePubkey(): string | null {
  const sk = getSecretKey();
  return sk ? getPublicKey(sk) : null;
}

/**
 * Publica un evento ya firmado a los relays y devuelve cuántos lo aceptaron.
 *
 * Usa un pool FRESCO por llamada (no uno a nivel de módulo): en serverless
 * (Vercel) las conexiones WebSocket quedan congeladas entre invocaciones y un
 * pool cacheado escribe sobre sockets zombie → el evento nunca llega al relay.
 */
async function publishToRelays(ev: Event): Promise<number> {
  const pool = new SimplePool();
  try {
    const results = await Promise.allSettled(pool.publish(RELAYS, ev));
    let ok = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") ok++;
      else console.warn(`[nostr] publish falló en ${RELAYS[i]}:`, r.reason);
    });
    return ok;
  } finally {
    pool.close(RELAYS);
  }
}

/**
 * Firma y publica el contrato de la apuesta como nota Nostr (kind:1, inmutable).
 * Devuelve el event id solo si al menos un relay aceptó el evento; null si no hay
 * clave configurada o si ningún relay lo aceptó (así no guardamos un link muerto).
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
  const accepted = await publishToRelays(ev).catch(() => 0);
  if (accepted === 0) {
    console.error("[nostr] el contrato no fue aceptado por ningún relay:", ev.id);
    return null;
  }
  return ev.id;
}

/** Republica un evento ya firmado (ej. el resultado firmado por el proveedor). */
export async function publishSignedEvent(ev: Event): Promise<void> {
  await publishToRelays(ev).catch(() => 0);
}

/**
 * Construye y firma el evento de resultado con la clave del oráculo gestionado
 * (camino con API key: Luna Negra firma en nombre del proveedor). No publica;
 * el núcleo de liquidación lo republica tras pagar.
 */
export function signResultEvent(
  sk: Uint8Array,
  betId: string,
  winnerNpubs: string[],
): Event {
  return finalizeEvent(buildResultEventTemplate({ betId, winnerNpubs }), sk);
}

/**
 * Firma (con el oráculo gestionado del proveedor) y publica una nota de
 * actividad del juego (kind:1) tagueada `lunanegra:game:<slug>` para que aparezca
 * en la pestaña Actividad. Devuelve `{ id, pubkey }` si algún relay la aceptó.
 */
export async function publishGameActivity(
  sk: Uint8Array,
  slug: string,
  content: string,
): Promise<{ id: string; pubkey: string } | null> {
  const ev = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["t", gameTag(slug)]],
      content,
    },
    sk,
  );
  const accepted = await publishToRelays(ev).catch(() => 0);
  if (accepted === 0) {
    console.error("[nostr] la actividad del juego no fue aceptada:", ev.id);
    return null;
  }
  return { id: ev.id, pubkey: ev.pubkey };
}

export type PublishedGameArticle = {
  id: string; // id del evento 30023 (cambia en cada edición)
  pubkey: string; // pubkey de la tienda
  coord: string; // coordenada direccionable `30023:<pubkey>:<slug>`
  publishedAt: number; // `published_at` usado (preservado entre ediciones)
  createdAt: number; // created_at del evento (freshness para el sync)
};

/**
 * Firma y publica (o re-publica) el ARTÍCULO NIP-23 (kind:30023) de un juego con
 * la clave de la tienda. Es la representación canónica del juego publicado: al
 * ser direccionable (tag `d` = slug), editarlo no cambia su coordenada, así que
 * los comentarios/reseñas que cuelgan de `coord` (tag `a`) quedan intactos.
 *
 * `publishedAt` debe ser la fecha del PRIMER posteo (el caller la preserva entre
 * ediciones). Devuelve los datos del evento solo si algún relay lo aceptó; `null`
 * si no hay clave o ningún relay lo aceptó (para no cachear un evento muerto).
 */
export async function publishGameArticle(
  game: GameArticleInput,
  gamePageUrl: string,
  publishedAt: number,
): Promise<PublishedGameArticle | null> {
  const sk = getSecretKey();
  if (!sk) return null;

  const template = buildGameArticleTemplate(game, { gamePageUrl, publishedAt });
  const ev = finalizeEvent(template, sk);
  const accepted = await publishToRelays(ev).catch(() => 0);
  if (accepted === 0) {
    console.error("[nostr] el artículo del juego no fue aceptado:", ev.id);
    return null;
  }
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    coord: gameArticleCoord(ev.pubkey, game.slug),
    publishedAt,
    createdAt: ev.created_at,
  };
}
