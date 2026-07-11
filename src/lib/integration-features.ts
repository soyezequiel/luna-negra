// Catálogo de las "interfaces" de Luna Negra que un juego puede integrar (los
// bloques §1–§8 de la guía /dev). Compartido entre el helper de telemetría, el
// probador en vivo y la UI (proveedor + admin), para que la lista, los títulos y
// el alcance sean una sola fuente de verdad.

export type IntegrationFeature =
  | "sso"
  | "purchase"
  | "presence"
  | "rooms"
  | "leaderboards"
  | "bets"
  | "webhooks";

// "game" = la llamada trae gameId y se atribuye a UN juego.
// "provider" = la llamada solo trae la API key del proveedor (presencia, social,
// webhooks); se atribuye al proveedor y aplica a todos sus juegos.
export type FeatureScope = "game" | "provider";

export type FeatureMeta = {
  key: IntegrationFeature;
  section: string; // "§1"
  title: string;
  scope: FeatureScope;
  desc: string;
  // §1 (SSO) es el mínimo recomendado; el resto es opcional.
  required: boolean;
};

export const INTEGRATION_FEATURES: FeatureMeta[] = [
  {
    key: "sso",
    section: "§1",
    title: "Login SSO",
    scope: "game",
    required: true,
    desc: "El juego canjea ?lnToken= en GET /api/v1/session para saber quién es el jugador.",
  },
  {
    key: "purchase",
    section: "§2",
    title: "Verificar compra",
    scope: "game",
    required: false,
    desc: "Valida el acceso pago en el backend (JWKS o GET /api/v1/entitlements/verify).",
  },
  {
    key: "presence",
    section: "§3",
    title: "Presencia",
    scope: "provider",
    required: false,
    desc: "Heartbeat 'jugando X' desde el game server (POST /api/v1/presence).",
  },
  {
    key: "rooms",
    section: "§4",
    title: "Salas y estado",
    scope: "game",
    required: false,
    desc: "Multijugador con ?inviteToken=: roster y estado compartido de sala.",
  },
  {
    key: "leaderboards",
    section: "§6",
    title: "Marcadores",
    scope: "game",
    required: false,
    desc: "Rankings por juego (leaderboards/{name}).",
  },
  {
    key: "bets",
    section: "§7",
    title: "Apuestas y escrow",
    scope: "game",
    required: false,
    desc: "Pozos winner-takes-all custodiados en sats (POST /api/v1/bets).",
  },
  {
    key: "webhooks",
    section: "§8",
    title: "Webhooks",
    scope: "provider",
    required: false,
    desc: "Avisos firmados (purchase/bet/payout) a tu game server.",
  },
];

export const INTEGRATION_FEATURE_KEYS = INTEGRATION_FEATURES.map((f) => f.key);

export function featureMeta(key: IntegrationFeature): FeatureMeta {
  return INTEGRATION_FEATURES.find((f) => f.key === key)!;
}
