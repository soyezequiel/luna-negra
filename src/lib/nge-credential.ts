import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { prisma } from "./prisma";
import { encryptSecret, decryptSecret } from "./crypto-vault";
import { getStorePubkey } from "./nostr-server";
import { RELAYS } from "./constants";
import { buildNgeUri } from "./nge-uri";
import { ensureManagedOracle } from "./oracle-keys";

// Emisor de la credencial NGE v2 (la "NWC del escrow"). Genera/reusa la clave de
// cliente `C` por juego y devuelve la URI nostr+nge://. En v2 la URI es TODA la
// credencial: no se publica ningún bind event — la config (límites, fees) se
// pide por RPC (`get_info`) y la autenticación es por la firma de `C` en el
// canal cifrado (ver src/lib/nge-service.ts). Rotar la credencial ES la
// revocación (spec §6): el servicio deja de aceptar a la `C` anterior porque
// NgeCredential.servicePubkey ya no matchea. Ver docs/nge/nge-v2-spec.md.

export type IssueResult =
  | {
      ok: true;
      uri: string;
      escrowPubkey: string;
      servicePubkey: string;
      relays: string[];
      rotated: boolean;
    }
  | { ok: false; code: string; message: string };

/** Par de cliente (raw + cifrado) recién generado. */
function newServiceKey(): { sk: Uint8Array; pubkey: string; secretEnc: string } {
  const sk = generateSecretKey();
  return { sk, pubkey: getPublicKey(sk), secretEnc: encryptSecret(sk) };
}

/**
 * Emite (o re-emite) la credencial NGE de un juego. Idempotente: sin `rotate`
 * devuelve SIEMPRE la misma URI (reusa la clave guardada). Con `rotate` genera
 * una clave nueva e INVALIDA la anterior (revocación). El caller ya autorizó que
 * la sesión es dueña del juego.
 */
export async function issueNgeCredential(params: {
  gameId: string;
  rotate?: boolean;
}): Promise<IssueResult> {
  const escrowPubkey = getStorePubkey();
  if (!escrowPubkey) {
    return { ok: false, code: "STORE_NOT_CONFIGURED", message: "La tienda no tiene identidad Nostr" };
  }

  const game = await prisma.game.findUnique({
    where: { id: params.gameId },
    select: { status: true, providerId: true },
  });
  if (!game) return { ok: false, code: "GAME_NOT_FOUND", message: "Juego no encontrado" };
  if (game.status !== "published") {
    return { ok: false, code: "GAME_NOT_PUBLISHED", message: "El juego no está publicado" };
  }

  // Guard NGE v2: garantizar que el proveedor tenga oráculo GESTIONADO. NGE v2 firma
  // el resultado server-side (report_result no acepta un 1341 externo), así que un
  // proveedor BYO/self-signed no podría cobrar (INTERNAL/SELF_SIGNED_ORACLE en el
  // escrow). Al emitir la credencial lo dejamos gestionado y evitamos el callejón.
  await ensureManagedOracle(game.providerId);

  const existing = await prisma.ngeCredential.findUnique({ where: { gameId: params.gameId } });
  let sk: Uint8Array;
  let servicePubkey: string;
  let rotated = false;

  if (existing && !params.rotate) {
    sk = decryptSecret(existing.serviceSecretEnc);
    servicePubkey = existing.servicePubkey;
  } else {
    const fresh = newServiceKey();
    sk = fresh.sk;
    servicePubkey = fresh.pubkey;
    if (existing) {
      await prisma.ngeCredential.update({
        where: { gameId: params.gameId },
        data: { servicePubkey, serviceSecretEnc: fresh.secretEnc, rotatedAt: new Date() },
      });
      rotated = true;
    } else {
      await prisma.ngeCredential.create({
        data: { gameId: params.gameId, servicePubkey, serviceSecretEnc: fresh.secretEnc },
      });
    }
  }

  const uri = buildNgeUri({ escrowPubkey, relays: RELAYS, serviceSecret: sk });
  return { ok: true, uri, escrowPubkey, servicePubkey, relays: [...RELAYS], rotated };
}

/** Devuelve la credencial actual de un juego (sin rotar) o null si no se emitió. */
export async function getNgeCredential(gameId: string): Promise<
  { uri: string; escrowPubkey: string; servicePubkey: string; relays: string[] } | null
> {
  const escrowPubkey = getStorePubkey();
  if (!escrowPubkey) return null;
  const row = await prisma.ngeCredential.findUnique({ where: { gameId } });
  if (!row) return null;
  const sk = decryptSecret(row.serviceSecretEnc);
  return {
    uri: buildNgeUri({ escrowPubkey, relays: RELAYS, serviceSecret: sk }),
    escrowPubkey,
    servicePubkey: row.servicePubkey,
    relays: [...RELAYS],
  };
}
