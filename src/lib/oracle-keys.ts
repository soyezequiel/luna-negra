import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto-vault";

// Clave del ORÁCULO gestionado por proveedor. Luna Negra genera y CUSTODIA una
// clave Nostr por proveedor para firmar los eventos de resultado (y actividad)
// en su nombre, de modo que el game server NO necesite una clave Nostr propia:
// le alcanza con su API key.
//
// - `oraclePubkey` (hex) es público: contra él se validan los eventos firmados.
// - `oracleSecretEnc` es el secreto cifrado en reposo (ver crypto-vault). Nunca
//   se loguea ni se devuelve por la API.

/** Genera un keypair de oráculo y devuelve {pubkey, secretEnc} para persistir. */
export function generateOracleKey(): { pubkey: string; secretEnc: string } {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return { pubkey, secretEnc: encryptSecret(sk) };
}

/**
 * Asegura que el proveedor tenga clave de oráculo; la genera si falta.
 * Idempotente: si ya existe, no la toca. Devuelve el pubkey (hex).
 */
export async function ensureOracleKey(providerId: string): Promise<string> {
  const p = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { oraclePubkey: true, oracleSecretEnc: true },
  });
  if (!p) throw new Error(`Proveedor ${providerId} no encontrado`);
  if (p.oraclePubkey && p.oracleSecretEnc) return p.oraclePubkey;

  const { pubkey, secretEnc } = generateOracleKey();
  await prisma.provider.update({
    where: { id: providerId },
    data: { oraclePubkey: pubkey, oracleSecretEnc: secretEnc },
  });
  return pubkey;
}

/**
 * Secret key (bytes) del oráculo del proveedor para firmar server-side.
 * Devuelve null si el proveedor aún no tiene clave gestionada provisionada.
 */
export async function getOracleSecret(
  providerId: string,
): Promise<Uint8Array | null> {
  const p = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { oracleSecretEnc: true },
  });
  if (!p?.oracleSecretEnc) return null;
  return decryptSecret(p.oracleSecretEnc);
}

/**
 * Rota la clave del oráculo: genera un keypair nuevo y reemplaza pubkey+secreto.
 * IMPORTANTE: invalida los eventos firmados con la clave anterior (un self-signer
 * debe actualizar su clave a la nueva pubkey). Devuelve la nueva pubkey.
 */
export async function rotateOracleKey(providerId: string): Promise<string> {
  const { pubkey, secretEnc } = generateOracleKey();
  await prisma.provider.update({
    where: { id: providerId },
    data: { oraclePubkey: pubkey, oracleSecretEnc: secretEnc },
  });
  return pubkey;
}
