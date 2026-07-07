// Resolución del oráculo que valida el RESULTADO (1341) de una apuesta. Modelo
// unificado (ver docs/nostr-games-protocol-apuestas.md §5):
//  - NGP (contrato 1339 con `oracle` p-tag) → `bet.oraclePubkey` (TOFU por-apuesta:
//    el propio contrato declara su oráculo).
//  - REST v2/v1 legacy (sin contrato) → `Provider.oraclePubkey` (oráculo gestionado).
// Puro (sin DB) para testear la autorización sin relays ni prisma.

export type OracleBet = {
  oraclePubkey: string | null;
  provider: { oraclePubkey: string | null };
};

/** Pubkey (hex) contra la que se valida el 1341 de esta apuesta, o null si no hay. */
export function effectiveOracle(bet: OracleBet): string | null {
  return bet.oraclePubkey ?? bet.provider.oraclePubkey ?? null;
}

/** ¿`signerPubkey` es el oráculo que puede resolver esta apuesta? */
export function isValidResultSigner(bet: OracleBet, signerPubkey: string): boolean {
  const oracle = effectiveOracle(bet);
  return oracle != null && signerPubkey === oracle;
}
