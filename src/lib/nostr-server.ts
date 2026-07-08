import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { SimplePool, nip19, type Event } from "nostr-tools";
import { RELAYS, gameTag } from "./constants";
import { buildResultEventTemplate } from "./escrow";
import { buildResultEventTemplateV2 } from "./escrow-v2";
import {
  buildGameArticleTemplate,
  gameArticleCoord,
  type GameArticleInput,
} from "./game-article";
import { storeLightningAddress } from "./site-url";

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
 * Clave privada de la tienda (bytes) para módulos server-side que necesitan
 * cifrar/descifrar además de firmar (el servicio NGE v2 usa NIP-44 entre la
 * tienda `S` y cada cliente `C`). Nunca sale del proceso. Null si no hay clave.
 */
export function getStoreSecretKey(): Uint8Array | null {
  return getSecretKey();
}

// Memo a nivel PROCESO (globalThis): Turbopack duplica este módulo en varios
// chunks del server (rutas vs instrumentation), cada uno con su top-level. Con un
// `let` local, el warm-up del boot memoizaba en UNA copia y la ruta de crear
// apuesta (otra copia) volvía a pagar la lectura del kind:0 (~4-8s) igual.
declare global {
  // eslint-disable-next-line no-var
  var lunaEnsuredStoreProfileAddress: string | null | undefined;
}

/**
 * Publica la Lightning Address estable de Luna Negra en su kind:0, preservando
 * el resto del perfil. Los clientes usan este metadata para autorizar los
 * recibos kind:9735 de los depositos.
 */
export async function ensureStoreZapProfile(baseUrl: string): Promise<boolean> {
  const sk = getSecretKey();
  if (!sk) return process.env.NODE_ENV !== "production";

  const lud16 = storeLightningAddress(baseUrl);
  if (!lud16) return false;
  if (globalThis.lunaEnsuredStoreProfileAddress === lud16) return true;

  const pubkey = getPublicKey(sk);
  const readPool = new SimplePool();
  let latest: Event | null = null;
  try {
    const events = await readPool.querySync(RELAYS, {
      kinds: [0],
      authors: [pubkey],
      limit: 20,
    });
    latest = events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
  } catch {
    latest = null;
  } finally {
    readPool.close(RELAYS);
  }
  if (!latest) return false;

  let metadata: Record<string, unknown>;
  try {
    const parsed = JSON.parse(latest.content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    metadata = parsed as Record<string, unknown>;
  } catch {
    return false;
  }
  if (metadata.lud16 === lud16) {
    globalThis.lunaEnsuredStoreProfileAddress = lud16;
    return true;
  }
  if (typeof metadata.lud16 === "string" && metadata.lud16.trim()) {
    return false;
  }

  metadata.lud16 = lud16;
  const ev = finalizeEvent(
    {
      kind: 0,
      created_at: Math.max(
        Math.floor(Date.now() / 1000),
        (latest?.created_at ?? 0) + 1,
      ),
      tags: [],
      content: JSON.stringify(metadata),
    },
    sk,
  );
  const accepted = await publishToRelays(ev).catch(() => 0);
  if (accepted > 0) globalThis.lunaEnsuredStoreProfileAddress = lud16;
  return accepted > 0;
}

// Corte propio por relay: sin esto, un relay lento/colgado hace que `publish`
// espere el timeout interno del SimplePool (~10s) antes de rendirse, y como
// antes esperábamos a TODOS, el evento más rápido quedaba rehén del más lento.
const RELAY_PUBLISH_TIMEOUT_MS = 5_000;

function withRelayTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`relay timeout tras ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Publica un evento ya firmado a los relays y devuelve cuántos lo aceptaron.
 *
 * Resuelve APENAS un relay acepta (no espera a los lentos): para todos nuestros
 * usos —ancla del contrato, recibo 9735, artículo, nota de liquidación— alcanza
 * con que UN relay lo tenga para que el evento sea válido/direccionable. Los
 * relays restantes siguen publicando en segundo plano (best-effort) y el pool se
 * cierra cuando todos terminan; en el self-host (proceso vivo) esa cola completa.
 * Si NINGUNO acepta dentro del corte, devuelve 0 (el caller no guarda link muerto).
 *
 * Usa un pool FRESCO por llamada (no uno a nivel de módulo): en serverless las
 * conexiones WebSocket quedan congeladas entre invocaciones y un pool cacheado
 * escribe sobre sockets zombie → el evento nunca llega al relay.
 */
async function publishToRelays(ev: Event): Promise<number> {
  const pool = new SimplePool();
  const publishes = pool.publish(RELAYS, ev);
  return await new Promise<number>((resolve) => {
    let accepted = 0;
    let settled = 0;
    let resolved = false;
    publishes.forEach((p, i) => {
      withRelayTimeout(p, RELAY_PUBLISH_TIMEOUT_MS)
        .then(
          () => {
            accepted++;
            // Primer relay que acepta → devolvemos ya; el resto sigue en background.
            if (!resolved) {
              resolved = true;
              resolve(accepted);
            }
          },
          (reason) => console.warn(`[nostr] publish falló en ${RELAYS[i]}:`, reason),
        )
        .finally(() => {
          settled++;
          if (settled === publishes.length) {
            pool.close(RELAYS);
            // Ninguno aceptó: recién acá sabemos que el total es 0.
            if (!resolved) {
              resolved = true;
              resolve(accepted);
            }
          }
        });
    });
  });
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

/**
 * Republica un evento ya firmado (ej. el resultado firmado por el proveedor) y
 * devuelve cuántos relays lo aceptaron. El caller no debe guardar el id del
 * evento si devolvió 0 (ningún relay lo tiene → sería un link muerto).
 */
export async function publishSignedEvent(ev: Event): Promise<number> {
  return publishToRelays(ev).catch(() => 0);
}

/**
 * Firma con la clave de la tienda y publica un evento genérico (lo usa la capa
 * NGP de apuestas para el estado del escrow kind:31340). Devuelve el id solo si
 * al menos un relay lo aceptó; null si no hay clave o ninguno lo aceptó.
 */
export async function publishStoreEvent(template: {
  kind: number;
  tags: string[][];
  content: string;
  created_at?: number;
}): Promise<string | null> {
  const sk = getSecretKey();
  if (!sk) return null;
  const ev = finalizeEvent(
    {
      kind: template.kind,
      created_at: template.created_at ?? Math.floor(Date.now() / 1000),
      tags: template.tags,
      content: template.content,
    },
    sk,
  );
  const accepted = await publishToRelays(ev).catch(() => 0);
  return accepted > 0 ? ev.id : null;
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

/** Resultado v2: kind:1341 de la spec NGP, anclado (`e`) al contrato y (`a`) al
 *  juego. Mismo formato que los oráculos BYO — un solo formato de resultado. */
export function signResultEventV2(
  sk: Uint8Array,
  betId: string,
  winnerNpubs: string[],
  anchorEventId: string | null,
  gameCoord?: string | null,
): Event {
  return finalizeEvent(
    buildResultEventTemplateV2({ betId, winnerNpubs, anchorEventId, gameCoord }),
    sk,
  );
}

/** Re-publica un evento ya firmado y devuelve cuántos relays lo aceptaron. Lo usa
 *  el tick v2 para reintentar la publicación de un recibo 9735 propio que ningún
 *  relay aceptó en su momento (`depositReceiptOk = false`). */
export async function republishEvent(ev: Event): Promise<number> {
  return publishToRelays(ev).catch(() => 0);
}

// ───────────────────────────── Zaps v2 (NIP-57) ─────────────────────────────

/**
 * Firma un zap request (kind 9734) con la clave de la tienda. Lo usa el motor de
 * payouts v2: Luna Negra es la que zapea al ganador / dev / refund, así que el
 * 9734 lo firma la tienda (`p` = receptor, `e` = ancla). Null si no hay nsec.
 */
export function signZapRequest(unsigned: {
  kind: 9734;
  created_at: number;
  content: string;
  tags: string[][];
}): Event | null {
  const sk = getSecretKey();
  if (!sk) return null;
  return finalizeEvent(unsigned, sk);
}

/**
 * Construye, firma (con la clave de la tienda) y publica el recibo de zap (kind
 * 9735) de un depósito. Luna Negra actúa como wallet receptor NIP-57: emite el
 * recibo público del zap entrante, anclado (`e`) al contrato. El firmante del
 * 9735 es la tienda, así que terceros lo validan contra `getStorePubkey()`.
 *
 * Devuelve el evento firmado + cuántos relays lo aceptaron (para el retry del
 * tick), o null si no hay nsec configurado (dev sin claves).
 */
export async function publishZapReceipt(opts: {
  anchorEventId: string;
  bolt11: string;
  /** JSON del 9734 (firmado por el apostador, o sintético de la tienda para invitados). */
  descriptionZapRequest: string;
  /** Pubkey del apostador (tag `P`), si firmó su propio depósito. */
  zapperPubkey?: string | null;
  preimage?: string | null;
}): Promise<{ event: Event; accepted: number } | null> {
  const sk = getSecretKey();
  if (!sk) return null;
  const storePubkey = getPublicKey(sk);
  const tags: string[][] = [
    ["p", storePubkey], // receptor del zap = la tienda (custodia del pozo)
    ["e", opts.anchorEventId], // ancla del contrato
    ["k", "1"],
    ["bolt11", opts.bolt11],
    ["description", opts.descriptionZapRequest],
  ];
  if (opts.zapperPubkey) tags.push(["P", opts.zapperPubkey]); // emisor (mayúscula, NIP-57)
  if (opts.preimage) tags.push(["preimage", opts.preimage]);
  const ev = finalizeEvent(
    { kind: 9735, created_at: Math.floor(Date.now() / 1000), tags, content: "" },
    sk,
  );
  const accepted = await publishToRelays(ev).catch(() => 0);
  if (accepted === 0) {
    console.error("[nostr] el recibo de zap no fue aceptado por ningún relay:", ev.id);
  }
  return { event: ev, accepted };
}

/**
 * Firma y publica una nota de liquidación (kind:1) que resume públicamente cómo
 * se repartió el pozo de una apuesta v2 (ganadores, montos, ids de recibos, fees),
 * anclada (`e`) al contrato. Aporta auditabilidad cuando un payout salió por un
 * riel sin recibo 9735 (fallback LNURL) o para el corte de la casa. Devuelve el
 * id si algún relay la aceptó; null si no hay nsec o ningún relay la aceptó.
 */
export async function publishSettleNote(
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
    console.error("[nostr] la nota de liquidación no fue aceptada:", ev.id);
    return null;
  }
  return ev.id;
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
