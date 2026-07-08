// Kinds y tag de descubrimiento de la capa NGP de apuestas (escrow transparente).
// Módulo PURO (sin prisma/I/O): lo importan tanto los builders puros de eventos
// (escrow-v2.ts) como la capa server (ngp-bet-state.ts, que los re-exporta).
// Congelados en v1 de la spec: docs/nostr-games-protocol-apuestas.md (§1).

export const NGP_BET_CONTRACT_KIND = 1339; // contrato (regular, firma el retador)
export const NGP_BET_RESULT_KIND = 1341; // resultado (regular, firma el oráculo)
export const NGP_BET_STATE_KIND = 31340; // estado del escrow / terms (addressable)

// Tag `t` de descubrimiento de TODOS los eventos NGP de apuestas.
export const NGP_BET_TAG = "ngp-bet";
