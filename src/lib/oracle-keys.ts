import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { verifyEvent, type Event } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto-vault";

// Clave del ORÁCULO de un proveedor: firma los eventos de resultado (1341) y de
// actividad en su nombre. Dos modos de custodia:
//
//  - GESTIONADA (default): Luna Negra genera y CUSTODIA el par. El game server no
//    necesita clave Nostr propia: le alcanza con su API key y Luna firma por él.
//    `oraclePubkey` + `oracleSecretEnc` seteados, `oracleSelfSigned = false`.
//
//  - PROPIA / BYO (keyless, Slice 2): el proveedor trae su PROPIA clave. Luna solo
//    guarda `oraclePubkey` (público) — `oracleSecretEnc = null` — y NO puede firmar
//    por él: el juego firma sus 1341 y los publica (los levanta ngp-bet-result-sync)
//    o los postea a `/result` como `{event}`. `oracleSelfSigned = true`.
//
// En ambos modos `oraclePubkey` (hex) es la verdad contra la que se validan los
// eventos firmados; `oracleSecretEnc` nunca se loguea ni se devuelve por la API.

/** Genera un keypair de oráculo GESTIONADO y devuelve {pubkey, secretEnc}. */
export function generateOracleKey(): { pubkey: string; secretEnc: string } {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return { pubkey, secretEnc: encryptSecret(sk) };
}

/**
 * Asegura que el proveedor tenga clave de oráculo; genera una GESTIONADA solo si
 * NO tiene ninguna pubkey declarada. Idempotente y —clave para BYO— NUNCA pisa una
 * clave existente: si el proveedor ya declaró su pubkey propia (self-signed, sin
 * secreto), la devolvemos tal cual en vez de regenerar una gestionada encima.
 * Devuelve el pubkey (hex).
 */
export async function ensureOracleKey(providerId: string): Promise<string> {
  const p = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { oraclePubkey: true },
  });
  if (!p) throw new Error(`Proveedor ${providerId} no encontrado`);
  if (p.oraclePubkey) return p.oraclePubkey; // gestionada o BYO ya declarada: no tocar

  const { pubkey, secretEnc } = generateOracleKey();
  await prisma.provider.update({
    where: { id: providerId },
    data: { oraclePubkey: pubkey, oracleSecretEnc: secretEnc, oracleSelfSigned: false },
  });
  return pubkey;
}

/**
 * Secret key (bytes) del oráculo GESTIONADO del proveedor para firmar server-side.
 * Devuelve null si el proveedor no tiene clave gestionada provisionada O si firma
 * con clave propia (BYO): en ese caso Luna no custodia el secreto y no puede firmar.
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
 * Rota la clave del oráculo GESTIONADO: genera un keypair nuevo y reemplaza
 * pubkey+secreto. Lanza si el proveedor firma con clave propia (BYO): ahí no hay
 * nada que rotar del lado de Luna — el proveedor re-declara su clave con
 * `setSelfSignedOracle`. Devuelve la nueva pubkey.
 */
export async function rotateOracleKey(providerId: string): Promise<string> {
  const p = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { oracleSelfSigned: true },
  });
  if (p?.oracleSelfSigned) {
    throw new OracleSelfSignedError(
      "El proveedor firma con clave propia; no hay clave gestionada que rotar",
    );
  }
  const { pubkey, secretEnc } = generateOracleKey();
  await prisma.provider.update({
    where: { id: providerId },
    data: { oraclePubkey: pubkey, oracleSecretEnc: secretEnc, oracleSelfSigned: false },
  });
  return pubkey;
}

/** El proveedor firma con clave propia (BYO): Luna no puede firmar por él. */
export class OracleSelfSignedError extends Error {}

// Prueba de posesión: content que el proveedor debe firmar con SU clave de oráculo
// para declararla. Liga la firma a ESTE proveedor (anti-replay entre proveedores) y
// al propósito (no reutilizable como resultado/actividad). El `created_at` reciente
// acota el replay temporal.
export function oracleProofContent(providerId: string): string {
  return `luna-negra:oracle:claim:${providerId}`;
}

export const ORACLE_PROOF_MAX_AGE_S = 5 * 60; // 5 min de ventana para la prueba

export type SelfSignedResult =
  | { ok: true; oraclePubkey: string }
  | { ok: false; code: string; message: string };

/**
 * Núcleo de la prueba de posesión: firma válida, `content` == el reto esperado
 * (anti-replay entre sujetos) y `created_at` dentro de la ventana (anti-replay
 * temporal). PURO. Lo comparten la declaración BYO (por proveedor) y la del
 * oráculo de atestaciones (por juego).
 */
function validateProofOfPossession(
  expectedContent: string,
  proof: Event,
  nowS: number,
): SelfSignedResult {
  if (!proof || typeof proof !== "object" || typeof proof.pubkey !== "string") {
    return { ok: false, code: "BAD_PROOF", message: "Falta el evento de prueba firmado" };
  }
  if (!verifyEvent(proof)) {
    return { ok: false, code: "BAD_SIGNATURE", message: "La firma de la prueba es inválida" };
  }
  if (proof.content !== expectedContent) {
    return {
      ok: false,
      code: "WRONG_CHALLENGE",
      message: "El content de la prueba no coincide con el reto esperado",
    };
  }
  if (Math.abs(nowS - (proof.created_at ?? 0)) > ORACLE_PROOF_MAX_AGE_S) {
    return { ok: false, code: "STALE", message: "La prueba expiró; firmá una nueva" };
  }
  return { ok: true, oraclePubkey: proof.pubkey };
}

/**
 * Valida el evento de prueba de posesión de una clave de oráculo BYO. PURO (no toca
 * DB) para poder testear la seguridad sin relays ni prisma. Reglas: firma válida,
 * `content` == el reto ligado a ESTE proveedor (anti-replay entre proveedores),
 * `created_at` dentro de la ventana (anti-replay temporal). En éxito devuelve la
 * pubkey firmante = la clave BYO a declarar.
 */
export function validateOracleProof(
  providerId: string,
  proof: Event,
  nowS: number = Math.floor(Date.now() / 1000),
): SelfSignedResult {
  return validateProofOfPossession(oracleProofContent(providerId), proof, nowS);
}

// ── Oráculo de ATESTACIONES (NGP kind:31338, por juego) ──────────────────────
//
// Distinto del oráculo de APUESTAS de arriba: esta clave la custodia SIEMPRE el
// proveedor (su game server firma los 31338 con ella; Luna nunca firma) y se
// declara POR JUEGO. El artículo 30023 del juego la publica como tag
// ["oracle", pk] — la delegación que el verificador cruza contra el firmante.
// No participa de NGE: `ensureManagedOracle` no la toca.

/** Reto que el proveedor firma con la clave de atestaciones para declararla.
 *  Ligado al JUEGO (anti-replay entre juegos) y al propósito. */
export function attestationOracleProofContent(gameId: string): string {
  return `luna-negra:attestation-oracle:claim:${gameId}`;
}

/**
 * Valida la prueba de posesión de la clave de atestaciones de UN juego. PURO.
 * En éxito devuelve la pubkey firmante = la clave a declarar en
 * `Game.attestationOraclePubkey`.
 */
export function validateAttestationOracleProof(
  gameId: string,
  proof: Event,
  nowS: number = Math.floor(Date.now() / 1000),
): SelfSignedResult {
  return validateProofOfPossession(attestationOracleProofContent(gameId), proof, nowS);
}

/**
 * Declara la clave de oráculo PROPIA (BYO) del proveedor a partir de un evento de
 * prueba firmado por esa misma clave (validado por `validateOracleProof`). En éxito
 * setea `oraclePubkey` = firmante, BORRA el secreto gestionado (`oracleSecretEnc =
 * null`) y marca `oracleSelfSigned`. Puro respecto a auth (el caller ya resolvió que
 * la sesión es dueña del proveedor).
 */
export async function setSelfSignedOracle(
  providerId: string,
  proof: Event,
): Promise<SelfSignedResult> {
  const check = validateOracleProof(providerId, proof);
  if (!check.ok) return check;

  await prisma.provider.update({
    where: { id: providerId },
    data: {
      oraclePubkey: proof.pubkey,
      oracleSecretEnc: null,
      oracleSelfSigned: true,
    },
  });
  return { ok: true, oraclePubkey: proof.pubkey };
}

/**
 * Vuelve al oráculo GESTIONADO: genera un par nuevo custodiado por Luna y apaga el
 * modo BYO. Devuelve la nueva pubkey gestionada.
 */
export async function revertToManagedOracle(providerId: string): Promise<string> {
  const { pubkey, secretEnc } = generateOracleKey();
  await prisma.provider.update({
    where: { id: providerId },
    data: { oraclePubkey: pubkey, oracleSecretEnc: secretEnc, oracleSelfSigned: false },
  });
  return pubkey;
}

/**
 * ¿El proveedor necesita que Luna le provisione un oráculo GESTIONADO? True si no
 * custodia ningún secreto (sin oráculo) o firma con clave propia (BYO/self-signed).
 * Puro (sin DB) para testear la decisión sin prisma.
 */
export function needsManagedOracle(p: {
  oracleSecretEnc: string | null;
  oracleSelfSigned: boolean;
}): boolean {
  return !p.oracleSecretEnc || p.oracleSelfSigned;
}

/**
 * Garantiza que el proveedor tenga oráculo GESTIONADO (Luna custodia el secreto y
 * puede firmar server-side). Idempotente: si ya es gestionado no toca nada; si no
 * tiene oráculo o es BYO lo convierte a gestionado. Lo usa la emisión de credencial
 * NGE v2, que REQUIERE custodia gestionada para firmar el resultado — un proveedor
 * BYO no tiene forma de resolver por el RPC (`report_result` no acepta un evento
 * firmado). Devuelve la pubkey gestionada vigente.
 */
export async function ensureManagedOracle(providerId: string): Promise<string> {
  const p = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { oraclePubkey: true, oracleSecretEnc: true, oracleSelfSigned: true },
  });
  if (!p) throw new Error(`Proveedor ${providerId} no encontrado`);
  if (!needsManagedOracle(p)) return p.oraclePubkey!; // ya gestionado: no regenerar
  return revertToManagedOracle(providerId);
}
