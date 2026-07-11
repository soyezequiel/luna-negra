// Modelo de TRES COLUMNAS de cómo un juego puede integrarse con Luna Negra,
// cruzando la interfaz 1.0 (REST, §1–§8 — ver integration-features.ts) con la
// Nostr Games Protocol (NGP — ver docs/nostr-games-protocol.md):
//
//   • "solo-1.0"   → necesita un tercero confiable (custodia/verificación de pago).
//                    No tiene equivalente NGP puro; se queda en REST.
//   • "intermedio" → misma necesidad, dos caminos: la pata 1.0 (REST) y la pata
//                    NGP conviven. Es el "lugar intermedio".
//   • "solo-ngp"   → NGP nativo, sin equivalente en la REST 1.0.
//
// Fuente ÚNICA del layout y los textos, compartida por la matriz (proveedor +
// admin). Las patas 1.0 reusan las claves de INTEGRATION_FEATURES (telemetría
// real); las patas NGP declaran su estándar, su estado de implementación y qué
// señal observable —si alguna— las respalda.

import type { IntegrationFeature } from "./integration-features";

export type Column = "solo-1.0" | "intermedio" | "solo-ngp";

// Estado de la pata NGP:
//   "implementado" → ya corre en Luna Negra (marcador 31339, zaps, reseñas).
//   "declarado"    → implementado pero NO observable desde el server (reto NIP-17
//                    va cifrado E2E): solo sabemos la capacidad que declaró el dev.
//   "diseño"       → especificado en la spec, todavía sin código.
export type TwoZeroImpl = "implementado" | "declarado" | "diseño";

// Señal de uso NGP derivable de la DB. "none" = sin señal por juego
// (invitaciones: van cifradas o no dejan rastro).
//   betsV2   → apuestas por zaps (NIP-57): existe una ZapBet del juego (escrow v2).
//   login    → INFERIDA de los puntajes 31339 firmados por el jugador (para
//              firmarlos el juego tuvo que obtener su signer NIP-07/46).
//   presence → presencia NIP-38 vista por el probador de relays (se persiste).
//   oracle   → atestaciones kind:31338 vistas por el probador (se persisten).
export type TwoZeroSignal =
  | "scores"
  | "zaps"
  | "comments"
  | "betsV2"
  | "login"
  | "presence"
  | "oracle"
  | "none";

export type TwoZeroSide = {
  label: string; // estándar visible: "kind:31339", "NIP-38", …
  impl: TwoZeroImpl;
  signal: TwoZeroSignal;
  desc: string;
  // La pata está implementada pero NO deja señal observable por juego (el probador
  // no puede verificarla): el proveedor declara manualmente si la integró. Se
  // persiste en Game.manualCaps[key].
  manual?: boolean;
  // Capacidad que gestiona la TIENDA: la evidencia aparece por actividad de los
  // usuarios (zaps, reseñas), no porque el dev integre nada. La matriz la muestra
  // aparte, en una sección contraída, para no confundir el "qué te falta integrar".
  managed?: boolean;
};

export type CapabilityRow = {
  key: string;
  title: string;
  // Pata 1.0: features §1–§8 que cubren esta capacidad (se fusionan para el
  // badge). Vacío = no hay equivalente REST.
  oneZero: IntegrationFeature[];
  // Pata NGP: descriptor Nostr, o null si no hay equivalente Nostr.
  twoZero: TwoZeroSide | null;
};

export type IntegrationColumn = {
  id: Column;
  title: string;
  subtitle: string;
  rows: CapabilityRow[];
};

export const INTEGRATION_COLUMNS: IntegrationColumn[] = [
  {
    id: "solo-1.0",
    title: "Interfaz Luna dependiente",
    subtitle: "REST · custodia y confianza",
    rows: [
      {
        key: "purchase",
        title: "Verificar compra",
        oneZero: ["purchase"],
        twoZero: null,
      },
      {
        key: "webhooks",
        title: "Webhooks",
        oneZero: ["webhooks"],
        twoZero: null,
      },
    ],
  },
  {
    id: "intermedio",
    title: "Intermedio",
    subtitle: "Mismo objetivo, dos caminos (REST ⇆ Nostr)",
    rows: [
      {
        key: "identidad",
        title: "Identidad / login",
        oneZero: ["sso"],
        twoZero: {
          label: "NIP-07/46",
          impl: "implementado",
          signal: "login",
          manual: true,
          desc: "El jugador se identifica con su pubkey (NIP-07/46) sin canjear lnToken. No deja un evento propio, pero SE INFIERE: un puntaje kind:31339 firmado por el jugador prueba que el juego obtuvo su signer. Sin marcador, declarala manualmente.",
        },
      },
      {
        key: "marcador",
        title: "Marcador",
        oneZero: ["leaderboards"],
        twoZero: {
          label: "kind:31339",
          impl: "implementado",
          signal: "scores",
          desc: "Puntaje addressable firmado por el jugador; score-sync lo proyecta a la tabla Score (sourceEventId). El ranking se reconstruye desde Nostr.",
        },
      },
      {
        key: "presencia",
        title: "Presencia",
        oneZero: ["presence"],
        twoZero: {
          label: "NIP-38",
          impl: "implementado",
          signal: "presence",
          desc: "El propio jugador firma su estado 'jugando X' (kind:30315) anclado a la coordenada del juego. Se DETECTA SOLA: un job en background (live-presence) observa esos estados en los relays cada 30s y persiste la evidencia la primera vez que alguien juega — sin que el proveedor la declare a mano.",
        },
      },
      {
        // Clave `roomLink` (no `invitaciones`): esta fila declara Room Link, la
        // misma capacidad que habilita el botón «Invitar» (Game.manualCaps.roomLink).
        // Tildarla acá o en el toggle de la ficha es lo mismo.
        key: "roomLink",
        title: "Invitaciones (Room Link)",
        oneZero: [],
        twoZero: {
          label: "NIP-17 · ?join",
          impl: "implementado",
          signal: "none",
          manual: true,
          desc: "Invitar a jugar: un DM NIP-17 (o link directo) que apunta a tu sala `?join` hosteada por el juego. No deja rastro observable desde el server (URL + transporte propio, p. ej. WebSocket) → el proveedor declara si lo integró. Es lo que habilita el botón «Invitar» de Luna.",
        },
      },
      {
        key: "bets",
        title: "Apuestas y escrow",
        oneZero: ["bets"],
        twoZero: {
          label: "NIP-57 · zaps",
          impl: "implementado",
          signal: "betsV2",
          desc: "Escrow por zaps públicos (NIP-57): depósitos anclados al contrato, premio como profile-zap al ganador y nota de liquidación anclada. Misma custodia que la 1.0, pero el riel es Nostr. POST /api/v2/bets.",
        },
      },
    ],
  },
  {
    id: "solo-ngp",
    title: "Nostr Games Protocol (NGP)",
    subtitle: "NGP nativo",
    rows: [
      {
        key: "zaps",
        title: "Propinas y premios",
        oneZero: [],
        twoZero: {
          label: "NIP-57",
          impl: "implementado",
          signal: "zaps",
          managed: true,
          desc: "Zap firmado por el usuario al dev o al ganador; los recibos 9735 verificados alimentan el top de zappers por juego y por dev. Lo gestiona la tienda: el dev no integra nada.",
        },
      },
      {
        key: "resenas",
        title: "Reseñas y logros",
        oneZero: [],
        twoZero: {
          label: "NIP-23 / kind:1",
          impl: "implementado",
          signal: "comments",
          managed: true,
          desc: "Reseñas, comentarios y logros como kind:1 colgando de la coordenada del juego (tag a). Cualquier cliente Nostr los lee. Las reseñas las escriben los usuarios desde la tienda: el dev no integra nada (los logros los puede publicar el juego, opcional).",
        },
      },
      {
        key: "oraculo",
        title: "Marcador verificado",
        oneZero: [],
        twoZero: {
          label: "kind:31338",
          impl: "diseño",
          signal: "oracle",
          desc: "Un oráculo co-firma el score del jugador para premios/stakes (atestación). Propuesto en la spec, todavía sin implementar; si el probador encuentra 31338 en relays, cuenta como evidencia.",
        },
      },
    ],
  },
];

// Capacidad "Luna Room Link" (enlace de invitación a sala hosteada por el juego,
// ver docs/luna-room-link.md). Se declara manualmente (el server no puede observar
// el contrato de 6 pasos: es una URL `?join` + el transporte propio del juego):
// solo si el proveedor la marca, Luna muestra el botón "Invitar". Se persiste en
// Game.manualCaps["roomLink"] — la MISMA clave que declara la fila "Invitaciones
// (Room Link)" del catálogo de arriba y el toggle de la ficha del juego.
export const ROOM_LINK_CAP = "roomLink";

// Claves de capacidad declarables manualmente (Game.manualCaps). Sirve para
// validar en el server qué claves acepta el PATCH y de allowlist en el cliente.
// Se derivan del catálogo (patas `manual: true`: login, Room Link). `roomLink`
// también se lista explícito por si el toggle de la ficha se usa sin la matriz;
// el Set deduplica.
export const MANUAL_CAP_KEYS: string[] = [
  ...new Set([
    ...INTEGRATION_COLUMNS.flatMap((c) =>
      c.rows.filter((r) => r.twoZero?.manual).map((r) => r.key),
    ),
    ROOM_LINK_CAP,
  ]),
];
