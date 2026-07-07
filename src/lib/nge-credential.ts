import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { prisma } from "./prisma";
import { encryptSecret, decryptSecret } from "./crypto-vault";
import { getStorePubkey, publishStoreEvent } from "./nostr-server";
import { RELAYS } from "./constants";
import { storeLightningAddress } from "./site-url";
import { getEconomySettings } from "./economy-settings";
import { BET_MIN_SATS, BET_MAX_SATS } from "./escrow-v2-config";
import { buildNgeUri, buildBindTemplate } from "./nge-uri";

// Emisor de la credencial NGE (la "NWC del escrow"). Genera/reusa un par de
// servicio por juego, publica el bind event (kind:31340) y devuelve la URI
// nostr+nge://. La clave de servicio es el oráculo del juego vía TOFU: cuando el
// juego publica un 1339 declarándola como `oracle`, la ingesta la guarda en
// ZapBet.oraclePubkey y valida el 1341 contra ella (ver src/lib/ngp-bet-ingest.ts,
// bet-oracle.ts). El bind, además, deja la asociación oráculo↔juego pública y
// verificable (cierra el TOFU para terceros). Ver docs/nge/.

export type IssueResult =
  | {
      ok: true;
      uri: string;
      escrowPubkey: string;
      servicePubkey: string;
      gameCoord: string;
      relays: string[];
      rotated: boolean;
      bindPublished: boolean;
    }
  | { ok: false; code: string; message: string };

/** Par de servicio (raw + cifrado) recién generado. */
function newServiceKey(): { sk: Uint8Array; pubkey: string; secretEnc: string } {
  const sk = generateSecretKey();
  return { sk, pubkey: getPublicKey(sk), secretEnc: encryptSecret(sk) };
}

/**
 * Emite (o re-emite) la credencial NGE de un juego. Idempotente: sin `rotate`
 * devuelve SIEMPRE la misma URI (reusa la clave guardada). Con `rotate` genera una
 * clave nueva e invalida la anterior. Publica el bind en cada llamada (barato y
 * mantiene la config fresca). El caller ya autorizó que la sesión es dueña del juego.
 */
export async function issueNgeCredential(params: {
  gameId: string;
  baseUrl: string;
  rotate?: boolean;
}): Promise<IssueResult> {
  const escrowPubkey = getStorePubkey();
  if (!escrowPubkey) {
    return { ok: false, code: "STORE_NOT_CONFIGURED", message: "La tienda no tiene identidad Nostr" };
  }

  const game = await prisma.game.findUnique({
    where: { id: params.gameId },
    select: { nostrCoord: true, status: true, betFeePct: true, betDevFeePct: true, provider: { select: { betDevFeePct: true } } },
  });
  if (!game) return { ok: false, code: "GAME_NOT_FOUND", message: "Juego no encontrado" };
  if (game.status !== "published" || !game.nostrCoord) {
    return { ok: false, code: "GAME_NOT_PUBLISHED", message: "El juego no está publicado en Nostr (sin coordenada)" };
  }
  const gameCoord = game.nostrCoord;

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

  // Publicar el bind: coordenada + lud16 + límites + fees. Best-effort.
  const economy = await getEconomySettings();
  const lud16 = storeLightningAddress(params.baseUrl);
  // Mismos cortes que el motor: fee de la casa por juego→global; corte del dev
  // (juego→proveedor) acotado al tope del admin.
  const feePct = game.betFeePct ?? economy.betFeePct;
  const devFeePct = Math.min(
    game.betDevFeePct ?? game.provider.betDevFeePct,
    economy.betDevFeeMaxPct,
  );
  const bindTemplate = buildBindTemplate({
    servicePubkey,
    gameCoord,
    lud16,
    minStakeSats: BET_MIN_SATS,
    maxStakeSats: BET_MAX_SATS,
    feePct,
    devFeePct,
  });
  const bindId = await publishStoreEvent(bindTemplate);

  const uri = buildNgeUri({ escrowPubkey, relays: RELAYS, serviceSecret: sk });
  return {
    ok: true,
    uri,
    escrowPubkey,
    servicePubkey,
    gameCoord,
    relays: [...RELAYS],
    rotated,
    bindPublished: Boolean(bindId),
  };
}

/** Devuelve la credencial actual de un juego (sin rotar) o null si no se emitió. */
export async function getNgeCredential(gameId: string): Promise<
  { uri: string; escrowPubkey: string; servicePubkey: string; gameCoord: string; relays: string[] } | null
> {
  const escrowPubkey = getStorePubkey();
  if (!escrowPubkey) return null;
  const row = await prisma.ngeCredential.findUnique({ where: { gameId } });
  if (!row) return null;
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { nostrCoord: true } });
  if (!game?.nostrCoord) return null;
  const sk = decryptSecret(row.serviceSecretEnc);
  return {
    uri: buildNgeUri({ escrowPubkey, relays: RELAYS, serviceSecret: sk }),
    escrowPubkey,
    servicePubkey: row.servicePubkey,
    gameCoord: game.nostrCoord,
    relays: [...RELAYS],
  };
}
