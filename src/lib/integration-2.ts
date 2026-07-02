// Modelo de TRES COLUMNAS de cómo un juego puede integrarse con Luna Negra,
// cruzando la interfaz 1.0 (REST, §1–§8 — ver integration-features.ts) con la
// 2.0 (eventos Nostr — ver docs/perfil-juego-nostr.md):
//
//   • "solo-1.0"   → necesita un tercero confiable (custodia/verificación de pago).
//                    No tiene equivalente Nostr-puro; se queda en REST.
//   • "intermedio" → misma necesidad, dos caminos: la pata 1.0 (REST) y la pata
//                    2.0 (Nostr) conviven. Es el "lugar intermedio".
//   • "solo-2.0"   → Nostr-nativo, sin equivalente en la REST 1.0.
//
// Fuente ÚNICA del layout y los textos, compartida por la matriz (proveedor +
// admin). Las patas 1.0 reusan las claves de INTEGRATION_FEATURES (telemetría
// real); las patas 2.0 declaran su estándar, su estado de implementación y qué
// señal observable —si alguna— las respalda.

import type { IntegrationFeature } from "./integration-features";

export type Column = "solo-1.0" | "intermedio" | "solo-2.0";

// Estado de la pata 2.0 (Nostr):
//   "implementado" → ya corre en Luna Negra (marcador 31337, zaps, reseñas).
//   "declarado"    → implementado pero NO observable desde el server (reto NIP-17
//                    va cifrado E2E): solo sabemos la capacidad que declaró el dev.
//   "diseño"       → especificado en la spec, todavía sin código.
export type TwoZeroImpl = "implementado" | "declarado" | "diseño";

// Señal de uso 2.0 derivable de la DB. "challenge" = flag Game.supportsChallenges
// (los retos son cifrados, no hay telemetría). "none" = sin señal por juego.
export type TwoZeroSignal = "scores" | "zaps" | "comments" | "challenge" | "none";

export type TwoZeroSide = {
  label: string; // estándar visible: "kind:31337", "NIP-38", …
  impl: TwoZeroImpl;
  signal: TwoZeroSignal;
  desc: string;
};

export type CapabilityRow = {
  key: string;
  title: string;
  // Pata 1.0: features §1–§8 que cubren esta capacidad (se fusionan para el
  // badge). Vacío = no hay equivalente REST.
  oneZero: IntegrationFeature[];
  // Pata 2.0: descriptor Nostr, o null si no hay equivalente Nostr.
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
    title: "Solo 1.0",
    subtitle: "REST · custodia y confianza",
    rows: [
      {
        key: "purchase",
        title: "Verificar compra",
        oneZero: ["purchase"],
        twoZero: null,
      },
      {
        key: "bets",
        title: "Apuestas y escrow",
        oneZero: ["bets"],
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
          signal: "none",
          desc: "El jugador se identifica con su pubkey (NIP-07/46) sin canjear lnToken. Es el login estándar de Luna Negra; no deja rastro por juego.",
        },
      },
      {
        key: "marcador",
        title: "Marcador",
        oneZero: ["leaderboards"],
        twoZero: {
          label: "kind:31337",
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
          signal: "none",
          desc: "El propio jugador firma su estado 'jugando X' (kind:30315) anclado a la coordenada del juego, sin que el game server lo reporte. El riel de amigos lo reconoce por la coordenada (tag `a`).",
        },
      },
      {
        key: "salas",
        title: "Salas y estado",
        oneZero: ["rooms"],
        twoZero: {
          label: "NIP-29",
          impl: "diseño",
          signal: "none",
          desc: "Sala con estado compartido como grupo NIP-29. Diseñado; hoy las salas con estado en vivo se hacen por la REST 1.0 (§4).",
        },
      },
      {
        key: "invitaciones",
        title: "Invitaciones y amigos",
        oneZero: ["social"],
        twoZero: {
          label: "NIP-17",
          impl: "declarado",
          signal: "challenge",
          desc: "En la 2.0 la invitación a jugar ES el reto 1v1 por DM cifrado (NIP-17, gift-wrap). Cifrado E2E → el estado refleja la capacidad declarada con el toggle de abajo, no tráfico observado.",
        },
      },
    ],
  },
  {
    id: "solo-2.0",
    title: "Solo 2.0",
    subtitle: "Nostr-nativo",
    rows: [
      {
        key: "zaps",
        title: "Propinas y premios",
        oneZero: [],
        twoZero: {
          label: "NIP-57",
          impl: "implementado",
          signal: "zaps",
          desc: "Zap firmado por el usuario al dev o al ganador; los recibos 9735 verificados alimentan el top de zappers por juego y por dev.",
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
          desc: "Reseñas, comentarios y logros como kind:1 colgando de la coordenada del juego (tag a). Cualquier cliente Nostr los lee.",
        },
      },
      {
        key: "oraculo",
        title: "Marcador verificado",
        oneZero: [],
        twoZero: {
          label: "kind:31338",
          impl: "diseño",
          signal: "none",
          desc: "Un oráculo co-firma el score del jugador para premios/stakes (atestación). Propuesto en la spec, todavía sin implementar.",
        },
      },
    ],
  },
];
