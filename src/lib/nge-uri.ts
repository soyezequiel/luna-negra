import { nip19 } from "nostr-tools";

// Constructores PUROS (sin DB ni relays) de la credencial NGE: la URI de conexión
// y el bind event. Aislados de la orquestación (nge-credential.ts) para poder
// testear el formato sin prisma. Ver docs/nge/ y sdk/nge.ts (el consumidor).

// Estado/terms/bind comparten el kind addressable 31340 (se distinguen por `d`).
export const NGE_STATE_KIND = 31340;
// Tag de descubrimiento del protocolo + alias legacy que el escrow todavía filtra.
export const NGE_TAG = "nge";
export const NGE_TAG_LEGACY = "ngp-bet";

/** `d` del bind event: ata la clave de servicio (oráculo) a su config. */
export function bindDTag(servicePubkey: string): string {
  return `bind:${servicePubkey}`;
}

/**
 * Arma la URI mínima de 3 campos: `nostr+nge://<escrow>?relay=…&secret=<nsec>`.
 * El `secret` va como nsec (bech32); el SDK deriva de él la pubkey del oráculo.
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

export type BindConfig = {
  gameCoord: string;
  lud16?: string | null;
  minStakeSats: number;
  maxStakeSats: number;
  feePct: number;
  devFeePct: number;
};

/**
 * Template (sin firmar) del bind event kind:31340. Lo firma la tienda con
 * `publishStoreEvent`. `a` lleva la coordenada del juego; el content, lo que la
 * URI ya no carga (lud16, límites, fees) — el SDK lo resuelve al arrancar.
 */
export function buildBindTemplate(
  params: { servicePubkey: string } & BindConfig,
): { kind: number; tags: string[][]; content: string } {
  const content = JSON.stringify({
    ...(params.lud16 ? { lud16: params.lud16 } : {}),
    minStakeSats: params.minStakeSats,
    maxStakeSats: params.maxStakeSats,
    feePct: params.feePct,
    devFeePct: params.devFeePct,
  });
  return {
    kind: NGE_STATE_KIND,
    tags: [
      ["d", bindDTag(params.servicePubkey)],
      ["p", params.servicePubkey],
      ["a", params.gameCoord],
      ["t", NGE_TAG],
      ["t", NGE_TAG_LEGACY],
    ],
    content,
  };
}
