import { finalizeEvent } from "nostr-tools/pure";
import { SimplePool, nip19, type Event } from "nostr-tools";
import { APP_NAME, RELAYS, gameTag } from "./constants";
import { priceLabel } from "./format";

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

export type GameAnnouncement = {
  slug: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  priceSats: number;
  gameUrl: string; // URL absoluta a la ficha del juego en la tienda
};

/**
 * Publica el anuncio raíz de un juego como nota Nostr (kind:1) firmada por Luna
 * Negra al aprobarlo. Comentarios y reseñas se cuelgan de este evento como
 * respuestas (NIP-10). El cuerpo incluye título, descripción, precio, link a la
 * ficha y la portada (URL en su propia línea, para que los clientes la muestren).
 *
 * Devuelve `{ id, pubkey }` solo si algún relay aceptó el evento; `null` si no
 * hay clave configurada o si ningún relay lo aceptó (para no guardar un id muerto).
 */
export async function publishGameAnnouncement(
  game: GameAnnouncement,
): Promise<{ id: string; pubkey: string } | null> {
  const sk = getSecretKey();
  if (!sk) return null;

  const lines = [`🎮 ${game.title} — ya disponible en ${APP_NAME}`];
  const desc = game.description?.trim();
  if (desc) lines.push("", desc.slice(0, 500));
  lines.push("", `💰 ${priceLabel(game.priceSats)}`, `🔗 ${game.gameUrl}`);
  if (game.coverUrl) lines.push("", game.coverUrl);

  const tags: string[][] = [
    ["t", gameTag(game.slug)],
    ["r", game.gameUrl],
  ];
  if (game.coverUrl) tags.push(["r", game.coverUrl], ["image", game.coverUrl]);

  const ev = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: lines.join("\n"),
    },
    sk,
  );
  const accepted = await publishToRelays(ev).catch(() => 0);
  if (accepted === 0) {
    console.error("[nostr] el anuncio del juego no fue aceptado:", ev.id);
    return null;
  }
  return { id: ev.id, pubkey: ev.pubkey };
}
