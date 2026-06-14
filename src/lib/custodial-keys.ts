import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { encryptSecret, decryptSecret } from "@/lib/crypto-vault";

// Identidad Nostr CUSTODIAL: para usuarios que entran por email (magic link) y no
// traen una clave propia, Luna Negra genera el keypair y custodia la privada
// cifrada en reposo (`nsecEnc`, AES-256-GCM via crypto-vault). Esa nsec se le
// entrega al navegador al loguear (para firmar comentarios/DMs/presencia como
// cualquier cuenta Nostr) y el usuario la puede exportar desde su perfil.

export type CustodialIdentity = {
  pubkey: string; // hex
  npub: string;
  nsec: string; // bech32 — se entrega al cliente, nunca se persiste en claro
  nsecEnc: string; // blob cifrado para guardar en User.nsecEnc
};

/** Genera un keypair custodial nuevo (clave en claro + cifrada para persistir). */
export function generateCustodialIdentity(): CustodialIdentity {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return {
    pubkey,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(sk),
    nsecEnc: encryptSecret(sk),
  };
}

/** Descifra el `nsecEnc` guardado y lo devuelve como bech32 (nsec1…). */
export function decryptNsec(nsecEnc: string): string {
  return nip19.nsecEncode(decryptSecret(nsecEnc));
}
