import { verifyEvent, type Event } from "nostr-tools";
import {
  buildGameArticleTemplate,
  GAME_ARTICLE_KIND,
  type GameArticleInput,
} from "./game-article";

/**
 * Validación server-side de eventos FIRMADOS POR EL PROVEEDOR en su navegador
 * (régimen `Game.articleSigner === "provider"`): el artículo NIP-23 del juego
 * (kind:30023) y su borrado NIP-09 (kind:5). El server nunca firma por el
 * proveedor; solo verifica que lo que llega firmado corresponde EXACTAMENTE al
 * estado canónico del juego en la DB (mismo saneado y mismos campos que revisa
 * el admin), y recién entonces lo guarda o difunde. Sin esta comparación, el
 * proveedor podría colar en Nostr un artículo distinto del que fue aprobado.
 *
 * Módulo PURO server-safe (no toca relays ni DB): recibe todo por parámetro.
 */

export type ArticleValidation =
  | { ok: true; event: Event }
  | { ok: false; error: string };

// Tolerancia hacia el futuro del `created_at`/`published_at` (reloj del cliente
// adelantado). Hacia el pasado no exigimos nada: toda edición de la ficha borra
// la firma pendiente (PATCH), así que una firma vieja nunca es de OTRA ficha.
const MAX_FUTURE_SKEW_SECONDS = 600;

/** ¿Tiene la forma mínima de un evento Nostr firmado? (antes de verifyEvent). */
function asEvent(value: unknown): Event | null {
  if (!value || typeof value !== "object") return null;
  const ev = value as Record<string, unknown>;
  if (
    typeof ev.id !== "string" ||
    typeof ev.pubkey !== "string" ||
    typeof ev.sig !== "string" ||
    typeof ev.kind !== "number" ||
    typeof ev.content !== "string" ||
    typeof ev.created_at !== "number" ||
    !Array.isArray(ev.tags)
  ) {
    return null;
  }
  return value as Event;
}

function firstTag(ev: Event, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}

/**
 * Valida que un kind:30023 firmado por el proveedor corresponde EXACTAMENTE al
 * template canónico del juego. Estrictez: `content` idéntico y tags idénticos
 * (mismo orden — el cliente firma el template que le dio el server sin tocarlo,
 * y buildGameArticleTemplate es determinístico), SALVO `published_at`, que se
 * toma del evento (validado numérico y no-futuro) y se reinyecta al reconstruir
 * (así una re-firma preserva la fecha del primer posteo sin round-trips).
 */
export function validateProviderArticle(opts: {
  signedEvent: unknown;
  game: GameArticleInput;
  /** Pubkey (hex) canónica del dueño del proveedor (User.pubkey de la DB). */
  expectedPubkey: string;
  /** Misma URL de ficha que usa el template del server (gamePageUrl(req, slug)). */
  gamePageUrl: string;
}): ArticleValidation {
  const ev = asEvent(opts.signedEvent);
  if (!ev) return { ok: false, error: "El evento firmado no tiene forma de evento Nostr" };

  let valid = false;
  try {
    valid = verifyEvent(ev);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "La firma del evento no verifica" };

  if (ev.kind !== GAME_ARTICLE_KIND) {
    return { ok: false, error: `El evento no es un artículo de juego (kind:${GAME_ARTICLE_KIND})` };
  }
  if (ev.pubkey !== opts.expectedPubkey) {
    return { ok: false, error: "El artículo no está firmado por tu cuenta Nostr" };
  }
  if (firstTag(ev, "d") !== opts.game.slug) {
    return { ok: false, error: "El artículo no corresponde a este juego (tag d ≠ slug)" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (ev.created_at > nowSec + MAX_FUTURE_SKEW_SECONDS) {
    return { ok: false, error: "El evento viene fechado en el futuro" };
  }
  const publishedAt = Number(firstTag(ev, "published_at"));
  if (!Number.isFinite(publishedAt) || publishedAt <= 0) {
    return { ok: false, error: "El artículo no trae un published_at válido" };
  }
  if (publishedAt > nowSec + MAX_FUTURE_SKEW_SECONDS) {
    return { ok: false, error: "El published_at viene fechado en el futuro" };
  }

  // Reconstruimos el template canónico con el MISMO builder del server y
  // comparamos estricto. Si el proveedor (o una extensión) tocó cualquier campo
  // después de pedir el template, acá se corta.
  const expected = buildGameArticleTemplate(opts.game, {
    gamePageUrl: opts.gamePageUrl,
    publishedAt,
  });
  if (ev.content !== expected.content) {
    return {
      ok: false,
      error: "La firma no corresponde a la versión actual de la ficha; volvé a firmar",
    };
  }
  if (JSON.stringify(ev.tags) !== JSON.stringify(expected.tags)) {
    return {
      ok: false,
      error: "La firma no corresponde a la versión actual de la ficha; volvé a firmar",
    };
  }

  return { ok: true, event: ev };
}

/**
 * Valida un kind:5 (borrado NIP-09) del proveedor que referencia el artículo del
 * juego: firmado por su pubkey y apuntando al `nostrEventId` (tag `e`) o a la
 * coordenada (`a`). Best-effort en los callers: si no valida, se borra solo de
 * la DB sin retractar el artículo.
 */
export function validateProviderDeletion(opts: {
  signedEvent: unknown;
  expectedPubkey: string;
  nostrEventId: string | null;
  nostrCoord: string | null;
}): ArticleValidation {
  const ev = asEvent(opts.signedEvent);
  if (!ev) return { ok: false, error: "El evento firmado no tiene forma de evento Nostr" };

  let valid = false;
  try {
    valid = verifyEvent(ev);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "La firma del evento no verifica" };

  if (ev.kind !== 5) {
    return { ok: false, error: "El evento no es un borrado NIP-09 (kind:5)" };
  }
  if (ev.pubkey !== opts.expectedPubkey) {
    return { ok: false, error: "El borrado no está firmado por tu cuenta Nostr" };
  }

  const referencesArticle = ev.tags.some(
    (t) =>
      (t[0] === "e" && opts.nostrEventId && t[1] === opts.nostrEventId) ||
      (t[0] === "a" && opts.nostrCoord && t[1] === opts.nostrCoord),
  );
  if (!referencesArticle) {
    return { ok: false, error: "El borrado no referencia el artículo de este juego" };
  }

  return { ok: true, event: ev };
}
