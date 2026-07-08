import { buildContractText, pubkeyFromNpub } from "./escrow";
import { BET_V2_CONTRACT_TAG } from "./escrow-v2-config";
import { NGP_BET_RESULT_KIND, NGP_BET_TAG } from "./ngp-kinds";

// Helpers específicos del contrato v2. Todo lo PURO (validación, hash, economía)
// se reutiliza tal cual de escrow.ts / escrow-math.ts: v2 comparte el mismo
// `computeContractHash` (mismos campos → CONTRACT_MISMATCH idéntico) y solo
// adorna el texto/tags del evento ancla con la particularidad de los zaps.

/**
 * Texto del contrato v2 (kind:1, ancla de depósitos y liquidación). Reutiliza el
 * texto de v1 y le agrega una línea aclarando que el movimiento del pozo queda
 * anclado a este evento. `Parameters<typeof buildContractText>[0]` mantiene la
 * firma acoplada a la de v1 sin re-declarar el shape.
 */
export function buildContractTextV2(
  p: Parameters<typeof buildContractText>[0],
): string {
  return `${buildContractText(p)}
Depósitos y premio quedan anclados a este contrato con recibos públicos.`;
}

/**
 * Plantilla del evento de resultado v2: **kind:1341 de la spec NGP** (regular,
 * inmutable — docs/nostr-games-protocol-apuestas.md §5), el MISMO formato que
 * publican los oráculos BYO y que ingiere ngp-bet-result-sync. Antes v2 publicaba
 * un kind:30078 propietario (tags `d`/`winner`) que divergía de la spec; ahora el
 * resultado gestionado y el externo hablan un solo formato.
 *
 * Tags: `e` = ancla del contrato (navegable), `a` = coordenada del juego,
 * `p` = pubkey de cada ganador, `status` = win|draw, `bet` = id interno
 * (correlación), `t` = ngp-bet (descubrimiento). `winners` vacío = empate/
 * anulación → `status=draw`, sin `p`.
 */
export function buildResultEventTemplateV2(p: {
  betId: string;
  winnerNpubs: string[];
  anchorEventId?: string | null;
  gameCoord?: string | null;
  createdAt?: number;
}): { kind: number; created_at: number; tags: string[][]; content: string } {
  const winnerPubkeys = p.winnerNpubs
    .map((n) => pubkeyFromNpub(n))
    .filter((pk): pk is string => Boolean(pk));
  const anchorReal = p.anchorEventId && !p.anchorEventId.startsWith("dev-anchor-");
  return {
    kind: NGP_BET_RESULT_KIND,
    created_at: p.createdAt ?? Math.floor(Date.now() / 1000),
    tags: [
      ...(anchorReal ? [["e", p.anchorEventId!]] : []),
      ...(p.gameCoord ? [["a", p.gameCoord]] : []),
      ...winnerPubkeys.map((pk) => ["p", pk]),
      ["status", winnerPubkeys.length > 0 ? "win" : "draw"],
      ["bet", p.betId],
      ["t", NGP_BET_TAG],
    ],
    content: "",
  };
}

/**
 * Tags del evento ancla del contrato v2. `t` distinto de v1 para filtrar.
 * Editorial: SIN `p` tags de jugadores — cada apuesta les generaba una mención/
 * notificación pública en todos sus clientes Nostr. El registro máquina de los
 * asientos vive en el 31340 (`participants`); el hash `terms` sella los npubs.
 */
export function buildContractTagsV2(p: {
  betId: string;
  contractHash: string;
  zapReceiver?: { pubkey: string; relay: string } | null;
}): string[][] {
  return [
    ["t", BET_V2_CONTRACT_TAG],
    ["bet", p.betId],
    ["terms", p.contractHash],
    ...(p.zapReceiver
      ? [["zap", p.zapReceiver.pubkey, p.zapReceiver.relay]]
      : []),
  ];
}
