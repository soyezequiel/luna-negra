"use client";

import type { Event } from "nostr-tools";
import { getActiveSigner, restoreSigner, type LunaSigner } from "@/lib/signer";

/**
 * Lado NAVEGADOR del régimen `articleSigner === "provider"`: el proveedor firma
 * el artículo NIP-23 de su juego (kind:30023) y su borrado (kind:5) con su
 * propio signer (NIP-07 / NIP-46 / clave local — las cuentas custodiales de
 * email también tienen signer local). El template SIEMPRE lo construye el
 * server (GET article-template): acá solo se firma tal cual y se devuelve; el
 * server re-valida contra la ficha canónica antes de guardar/difundir.
 */

/** Signer activo (restaurándolo si la app recién monta); lanza si no hay. */
async function requireSigner(): Promise<LunaSigner> {
  const signer = getActiveSigner() ?? (await restoreSigner());
  if (!signer) throw new Error("Conectá tu Nostr para firmar el artículo");
  return signer;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return typeof data?.error === "string" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Pide el template canónico del artículo al server y lo firma con el signer
 * activo. Pre-chequea que el signer sea la cuenta dueña del proveedor (mejor
 * error acá que un 403 críptico después). Devuelve el evento firmado.
 */
export async function signGameArticle(gameId: string): Promise<Event> {
  const res = await fetch(`/api/provider/games/${gameId}/article-template`);
  if (!res.ok) {
    throw new Error(await readError(res, "No se pudo obtener el artículo a firmar"));
  }
  const { template, ownerPubkey } = (await res.json()) as {
    template: { kind: number; created_at: number; tags: string[][]; content: string };
    ownerPubkey: string;
  };

  const signer = await requireSigner();
  const signerPubkey = await signer.getPublicKey();
  if (signerPubkey !== ownerPubkey) {
    throw new Error(
      "Tu firmante Nostr no es la cuenta dueña del proveedor: iniciá sesión con la cuenta correcta",
    );
  }
  try {
    return await signer.signEvent(template);
  } catch {
    throw new Error(
      signer.method === "nip07"
        ? "Permiso denegado en tu extensión Nostr (kind:30023)"
        : "Tu firmante Nostr rechazó la firma del artículo",
    );
  }
}

/** POST genérico de un evento firmado a una ruta del juego; lanza con el error del server. */
async function postSigned(url: string, signedEvent: Event): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signedEvent }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "El servidor rechazó el evento firmado"));
  }
  return res;
}

/**
 * "Enviar a revisión" en un solo gesto: firma el artículo y hace el submit con
 * la firma adjunta (el admin la difunde al aprobar).
 */
export async function signAndSubmit(gameId: string): Promise<void> {
  const ev = await signGameArticle(gameId);
  await postSigned(`/api/provider/games/${gameId}/submit`, ev);
}

/**
 * Re-firma el artículo: repone una firma invalidada (draft/in_review tras una
 * edición) o firma-y-difunde los cambios de un juego ya publicado (articleDirty).
 */
export async function signAndPushArticle(gameId: string): Promise<void> {
  const ev = await signGameArticle(gameId);
  await postSigned(`/api/provider/games/${gameId}/article`, ev);
}

/**
 * Migra un juego LEGACY (artículo firmado por la tienda) a la cuenta del
 * proveedor: firma el artículo bajo su clave y el server lo difunde, actualiza
 * la coordenada y retracta el artículo viejo. ⚠️ La coordenada del juego CAMBIA
 * (cambia el pubkey): la actividad anclada a la coord vieja no migra.
 */
export async function signAndMigrateArticle(gameId: string): Promise<void> {
  const ev = await signGameArticle(gameId);
  await postSigned(`/api/provider/games/${gameId}/migrate-article`, ev);
}

/**
 * Firma el kind:5 (borrado NIP-09) del artículo del juego. Devuelve null si el
 * juego no tiene artículo publicado o no hay signer (el borrado en DB procede
 * igual: el kind:5 es best-effort).
 */
export async function signGameDeletion(game: {
  nostrEventId: string | null;
  nostrCoord: string | null;
}): Promise<Event | null> {
  if (!game.nostrEventId) return null;
  let signer: LunaSigner;
  try {
    signer = await requireSigner();
  } catch {
    return null;
  }
  const tags: string[][] = [["e", game.nostrEventId]];
  if (game.nostrCoord) tags.push(["a", game.nostrCoord]);
  tags.push(["k", "30023"]);
  try {
    return await signer.signEvent({
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "Juego eliminado de Luna Negra",
    });
  } catch {
    return null; // firma rechazada: se borra solo de la DB
  }
}
