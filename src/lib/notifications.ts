// Tipos compartidos del centro de notificaciones (campanita).
//
// El feed se DERIVA en lectura: el server arma los ítems desde la DB (compras,
// zaps, reseñas, apuestas del jugador y comentarios). Los comentarios son un
// caché de los kind:1 de Nostr —fuente de verdad— que mantiene `comment-sync.ts`
// (como `Zap` cachea los recibos 9735). No hay tabla `Notification`: el estado de
// leído/no leído es una sola marca `User.notificationsSeenAt`, y cuenta como no
// leído todo ítem con `at` posterior a esa marca. Ver:
//   - GET  /api/notifications        (ítems de DB + marca + descartes)
//   - POST /api/notifications/seen   (avanza la marca)
//   - POST /api/notifications/dismiss(descarta un ítem)
//   - use-notifications-center.ts    (unread + descartes)

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
  /** Claves (NotifItem.id) que el usuario descartó: se filtran del feed. */
  dismissed: string[];
};
