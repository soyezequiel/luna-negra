import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";

// Identidades EFÍMERAS para apuestas anónimas (sin cuentas Nostr). Pensadas para
// un duelo local en un stand: cada asiento es un jugador anónimo que deposita su
// stake por QR y, si gana, cobra el pozo por LNURL-withdraw (no tiene wallet
// asociada, así que el escrow fuerza `withdraw_pending` — ver escrow-payout.ts).
//
// A diferencia de las cuentas custodiales por email, acá NO guardamos la clave
// privada (`nsecEnc` queda null): el invitado nunca firma nada (los depósitos los
// cobra el escrow, el resultado lo firma el oráculo del proveedor y el retiro va
// con un token firmado por el server), así que la privada se descarta.

export type GuestIdentity = { userId: string; pubkey: string; npub: string };

/**
 * Crea `count` usuarios invitados nuevos (un keypair aleatorio cada uno) y los
 * persiste. Devuelve la identidad de cada asiento EN ORDEN (asiento 1..N), para
 * que el proveedor pueda mapear asiento → npub y luego reportar al ganador.
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
      },
      select: { id: true },
    });
    guests.push({ userId: user.id, pubkey, npub });
  }
  return guests;
}
