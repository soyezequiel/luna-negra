import { nip19 } from "nostr-tools";

// Constructor PURO (sin DB ni relays) de la URI de conexión NGE v2. Aislado de
// la orquestación (nge-credential.ts) para poder testear el formato sin prisma.
// En v2 la URI es TODA la credencial: la config (límites, fees, métodos) se pide
// por RPC (`get_info`) — murió el bind event de v1. Ver docs/nge/nge-v2-spec.md
// y sdk/nge.ts (el consumidor).

/**
 * Arma la URI mínima de 3 campos: `nostr+nge://<escrow>?relay=…&secret=<nsec>`.
 * - host = pubkey estable del escrow `S` (hacia ella cifra el juego y con ella
 *   verifica toda response),
 * - `secret` = clave del cliente `C` como nsec (bech32); el SDK deriva de él la
 *   pubkey con la que el escrow lo autentica.
 */
export function buildNgeUri(params: {
  escrowPubkey: string;
  relays: string[];
  serviceSecret: Uint8Array;
}): string {
  const q = new URLSearchParams();
  for (const r of params.relays) q.append("relay", r);
  q.set("secret", nip19.nsecEncode(params.serviceSecret));
  return `nostr+nge://${params.escrowPubkey}?${q.toString()}`;
}
