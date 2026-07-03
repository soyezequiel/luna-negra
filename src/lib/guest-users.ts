import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto-vault";

// Identidades EFÍMERAS de Nostr para apuestas anónimas (sin cuentas propias).
// Pensadas para un duelo en un stand: cada asiento es un jugador anónimo que
// deposita su stake y, si gana sin `lud16`, cobra el pozo por LNURL-withdraw (QR),
// porque el escrow fuerza `withdraw_pending` (ver escrow-payout.ts / escrow-v2-payout.ts).
//
// Igual que las cuentas custodiales por email, Luna Negra CUSTODIA la clave privada
// cifrada en reposo (`nsecEnc`, AES-256-GCM). En v2 (zaps) el depósito es un zap
// NIP-57 que hay que FIRMAR: como el invitado no tiene firmante propio, Luna firma
// el 9734 de su depósito en su nombre con esta clave (ver ensureCustodialDepositInvoiceV2
// en zap-bet.ts), y así puede pagar con cualquier wallet/extensión/QR. El resultado
// lo sigue firmando el oráculo del proveedor y el retiro va con token del server.

export type GuestIdentity = { userId: string; pubkey: string; npub: string };

/**
 * Crea `count` usuarios invitados nuevos (un keypair aleatorio cada uno, con la
 * privada cifrada guardada en `nsecEnc`) y los persiste. Devuelve la identidad de
 * cada asiento EN ORDEN (asiento 1..N), para que el proveedor pueda mapear
 * asiento → npub y luego reportar al ganador.
 */
export async function createGuestUsers(count: number): Promise<GuestIdentity[]> {
  const guests: GuestIdentity[] = [];
  for (let seat = 0; seat < count; seat += 1) {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const npub = nip19.npubEncode(pubkey);
    const user = await prisma.user.create({
      data: {
        npub,
        pubkey,
        displayName: `Jugador ${seat + 1}`,
        nsecEnc: encryptSecret(sk),
      },
      select: { id: true },
    });
    guests.push({ userId: user.id, pubkey, npub });
  }
  return guests;
}
