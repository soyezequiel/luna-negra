import { buildContractText, buildResultEventTemplate } from "./escrow";
import { BET_V2_CONTRACT_TAG } from "./escrow-v2-config";

// Helpers específicos del contrato v2. Todo lo PURO (validación, hash, economía)
// se reutiliza tal cual de escrow.ts / escrow-math.ts: v2 comparte el mismo
// `computeContractHash` (mismos campos → CONTRACT_MISMATCH idéntico) y solo
// adorna el texto/tags del evento ancla con la particularidad de los zaps.

/**
 * Texto del contrato v2 (kind:1, ancla de depósitos y liquidación). Reutiliza el
 * texto de v1 y le agrega una línea aclarando que el dinero se mueve por zaps
 * públicos. `Parameters<typeof buildContractText>[0]` mantiene la
 * firma acoplada a la de v1 sin re-declarar el shape.
 */
export function buildContractTextV2(
  p: Parameters<typeof buildContractText>[0],
): string {
  return `${buildContractText(p)}
Depósitos: zaps públicos anclados a este contrato. Premio: profile-zap público de Luna Negra al ganador.`;
}

/**
 * Plantilla del evento de resultado v2 (kind:30078). Igual que v1 pero con un tag
 * `["e", anchorEventId]` para que el resultado también cuelgue del ancla y sea
 * navegable desde el contrato. Si no se pasa ancla (dev sin nsec), es idéntico a v1.
 */
export function buildResultEventTemplateV2(p: {
  betId: string;
  winnerNpubs: string[];
  anchorEventId?: string | null;
  createdAt?: number;
}): { kind: number; created_at: number; tags: string[][]; content: string } {
  const tpl = buildResultEventTemplate({
    betId: p.betId,
    winnerNpubs: p.winnerNpubs,
    createdAt: p.createdAt,
  });
  if (p.anchorEventId && !p.anchorEventId.startsWith("dev-anchor-")) {
    tpl.tags.push(["e", p.anchorEventId]);
  }
  return tpl;
}

/** Tags del evento ancla del contrato v2. `t` distinto de v1 para filtrar. */
export function buildContractTagsV2(p: {
  betId: string;
  contractHash: string;
  pubkeys: string[];
  zapReceiver?: { pubkey: string; relay: string } | null;
}): string[][] {
  return [
    ["t", BET_V2_CONTRACT_TAG],
    ["bet", p.betId],
    ["terms", p.contractHash],
    ...(p.zapReceiver
      ? [["zap", p.zapReceiver.pubkey, p.zapReceiver.relay]]
      : []),
    ...p.pubkeys.map((pk) => ["p", pk]),
  ];
}
