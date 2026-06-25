// Tipos compartidos del centro de notificaciones (campanita).
//
// El feed se DERIVA en lectura: el server arma los ítems desde tablas existentes
// (compras, zaps, reseñas, apuestas del jugador) y el cliente le suma los
// comentarios kind:1 traídos de relays. No hay tabla `Notification`: el estado
// de leído/no leído es una sola marca `User.notificationsSeenAt`, y cuenta como
// no leído todo ítem con `at` posterior a esa marca. Ver:
//   - GET  /api/notifications        (ítems de DB + marca + juegos para Nostr)
//   - POST /api/notifications/seen   (avanza la marca)
//   - use-notifications-center.ts    (merge con comentarios Nostr + unread)

export type NotifType = "purchase" | "zap" | "review" | "comment" | "bet";

export type NotifItem = {
  /** Id estable (dedup entre polls y key de React). */
  id: string;
  type: NotifType;
  /** Momento del evento, epoch ms (criterio de orden y de no-leído). */
  at: number;
  /** Juego al que pertenece (para el link y el contexto). */
  gameSlug?: string | null;
  gameTitle?: string | null;
  /** Quién originó el evento (comprador/zapper/reseñador/comentarista). */
  actorName?: string | null;
  actorNpub?: string | null;
  /** Monto en sats (compra/zap). */
  amountSats?: number | null;
  /** Puntaje 1-5 (reseña). */
  rating?: number | null;
  /** Texto libre (comentario de zap, cuerpo de reseña/comentario). */
  text?: string | null;
  /** Destino al hacer click. */
  href: string;
};

/** Respuesta de GET /api/notifications. `seenAt`/`at` son epoch ms. */
export type NotificationsResponse = {
  items: NotifItem[];
  seenAt: number | null;
  /** Juegos del dev con anuncio en Nostr, para traer comentarios del lado cliente. */
  games: {
    slug: string;
    title: string;
    nostrEventId: string;
    nostrPubkey: string;
  }[];
};
