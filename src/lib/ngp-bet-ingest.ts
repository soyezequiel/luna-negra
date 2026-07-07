import { SimplePool, nip19, verifyEvent, type Event } from "nostr-tools";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { RELAYS } from "./constants";
import { getStorePubkey } from "./nostr-server";
import { computeContractHash } from "./escrow";
import { getEconomySettings, resolveBetFees } from "./economy-settings";
import { satsToMsat } from "./money";
import {
  NGP_BET_CONTRACT_KIND,
  NGP_BET_TAG,
  NGP_BETS_ENABLED,
  publishNgpBetState,
} from "./ngp-bet-state";
import {
  BET_MIN_SATS,
  BET_MAX_SATS,
  BET_MAX_ANONYMOUS_SEATS,
  DEPOSIT_WINDOW_MS,
} from "./escrow-v2-config";

/**
 * Ingesta de CONTRATOS de apuesta por Nostr (NGP apuestas, Fase 2). El retador
 * publica un kind:1339 firmado con su clave (no la de Luna) y los participantes
 * lo fondean firmando un zap request 9734 cuyo `e` apunta al contrato. Cuando el
 * primer depósito llega al callback LNURL de la tienda y su `e` no corresponde a
 * ninguna apuesta conocida, materializamos la `zapBet` acá: buscamos el 1339 en
 * relays, lo validamos contra las condiciones publicadas del escrow (§2.1) y lo
 * proyectamos al MISMO modelo que crea `/api/v2/bets`, con `anchorEventId` = id
 * del 1339. De ahí en más el flujo es idéntico a v2 (depósito, tick, resultado).
 *
 * Sin API key: la autorización es la firma del retador + que el contrato nombre a
 * esta tienda como escrow y al oráculo registrado del proveedor. El intento de
 * fondeo es la única señal que despierta al escrow — publicar contratos basura no
 * genera trabajo hasta que alguien pone sats (anti-spam de la spec §3).
 *
 * Ver docs/nostr-games-protocol-apuestas.md (§2 y Fase 2).
 */

export type NgpIngestResult =
  | { ok: true; betId: string; gameId: string }
  | { ok: false; code: string; error: string };

const fail = (code: string, error: string): NgpIngestResult => ({ ok: false, code, error });

export type MaterializeOpts = {
  /** Camino LNURL: quien deposita debe ser participante del contrato (anti-spam). */
  requireSignerPubkey?: string;
  /** Camino eager (POST /from-contract): el juego del contrato debe ser del proveedor. */
  expectedProviderId?: string;
};

// Un `p` tag es de ROL si trae "escrow"/"oracle" como token después de la pubkey
// (índice 2 = relay hint opcional, 3 = marker NIP-10; aceptamos cualquiera de los
// dos para no atarnos a que venga el relay). El resto son participantes.
function roleOf(tag: string[]): "escrow" | "oracle" | null {
  for (const token of tag.slice(2)) {
    if (token === "escrow" || token === "oracle") return token;
  }
  return null;
}

/**
 * Trae el evento de contrato kind:1339 de los relays por id. Pool fresco por
 * llamada (se cierra al terminar): la ingesta es infrecuente —solo el primer
 * depósito de un contrato nuevo— y no queremos un socket zombi cacheado.
 */
async function fetchContractEvent(contractEventId: string): Promise<Event | null> {
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(
      RELAYS,
      { ids: [contractEventId], kinds: [NGP_BET_CONTRACT_KIND] },
      { maxWait: 5000 },
    );
    return events.find((e) => e.id === contractEventId) ?? null;
  } catch {
    return null;
  } finally {
    pool.close(RELAYS);
  }
}

/**
 * Materializa (o devuelve, si ya existe) la apuesta v2 correspondiente a un
 * contrato NGP kind:1339. Idempotente y seguro ante concurrencia: dos depósitos
 * casi simultáneos del mismo contrato compiten en el `@unique` de `anchorEventId`
 * (el perdedor cae en P2002 → re-lee y devuelve la misma apuesta).
 */
export async function materializeNgpBet(
  contractEventId: string,
  opts: MaterializeOpts = {},
): Promise<NgpIngestResult> {
  if (!NGP_BETS_ENABLED) return fail("NGP_DISABLED", "Las apuestas NGP están desactivadas");
  const storePubkey = getStorePubkey();
  if (!storePubkey) return fail("STORE_NOT_CONFIGURED", "La tienda no tiene identidad Nostr");

  // Carrera con otra materialización del mismo contrato: si ya existe, listo.
  const existing = await prisma.zapBet.findUnique({
    where: { anchorEventId: contractEventId },
    select: { id: true, gameId: true },
  });
  if (existing) return { ok: true, betId: existing.id, gameId: existing.gameId };

  const ev = await fetchContractEvent(contractEventId);
  if (!ev) return fail("CONTRACT_NOT_FOUND", "No se encontró el contrato en los relays");
  if (ev.kind !== NGP_BET_CONTRACT_KIND) return fail("BAD_KIND", "El evento no es un contrato de apuesta");
  if (!verifyEvent(ev)) return fail("BAD_SIGNATURE", "La firma del contrato es inválida");
  if (!ev.tags.some((t) => t[0] === "t" && t[1] === NGP_BET_TAG)) {
    return fail("NOT_NGP_BET", "El contrato no está marcado como apuesta NGP");
  }

  // Escrow declarado: DEBE ser esta tienda (si no, el contrato es de otro custodio).
  const pTags = ev.tags.filter((t) => t[0] === "p" && typeof t[1] === "string");
  const escrowPk = pTags.find((t) => roleOf(t) === "escrow")?.[1];
  if (escrowPk !== storePubkey) {
    return fail("WRONG_ESCROW", "El contrato no nombra a esta tienda como escrow");
  }

  // Oráculo declarado en el contrato (TOFU por-apuesta): el 1339 nombra su propio
  // oráculo y el resultado (1341) se valida contra ESA pubkey (ver ngp-bet-result-sync).
  // No exigimos registro previo del proveedor: el propio contrato es la fuente. Se
  // guarda en `bet.oraclePubkey`. (El chequeo `escrow == storePubkey` sí se mantiene.)
  const oraclePk = pTags.find((t) => roleOf(t) === "oracle")?.[1];
  if (!oraclePk) return fail("MISSING_ORACLE", "El contrato no declara un oráculo");

  // Juego por coordenada (`a` = 30023:<pubkey>:<slug>), publicado.
  const gameCoord = ev.tags.find((t) => t[0] === "a")?.[1];
  if (!gameCoord) return fail("MISSING_GAME", "El contrato no referencia un juego");
  const game = await prisma.game.findFirst({
    where: { nostrCoord: gameCoord, status: "published" },
    include: { provider: true },
  });
  if (!game) return fail("GAME_NOT_FOUND", "El juego del contrato no existe o no está publicado");
  if (opts.expectedProviderId && game.providerId !== opts.expectedProviderId) {
    return fail("NOT_GAME_OWNER", "El juego del contrato no es de tu proveedor");
  }

  // Participantes: los `p` sin rol, en orden. El firmante del depósito debe ser uno.
  const participantPubkeys = pTags.filter((t) => roleOf(t) === null).map((t) => t[1]);
  if (participantPubkeys.length < 2) {
    return fail("TOO_FEW_PARTICIPANTS", "El contrato necesita al menos 2 participantes");
  }
  if (participantPubkeys.length > BET_MAX_ANONYMOUS_SEATS) {
    return fail("TOO_MANY_PARTICIPANTS", `Como máximo ${BET_MAX_ANONYMOUS_SEATS} participantes`);
  }
  if (new Set(participantPubkeys).size !== participantPubkeys.length) {
    return fail("DUPLICATE_PARTICIPANT", "Hay participantes duplicados en el contrato");
  }
  if (opts.requireSignerPubkey && !participantPubkeys.includes(opts.requireSignerPubkey)) {
    return fail("SIGNER_NOT_PARTICIPANT", "Quien deposita no es participante del contrato");
  }

  // Stake dentro de las condiciones publicadas del escrow (§2.1).
  const stakeSats = Number(ev.tags.find((t) => t[0] === "stake")?.[1]);
  if (!Number.isInteger(stakeSats) || stakeSats < BET_MIN_SATS || stakeSats > BET_MAX_SATS) {
    return fail(
      "STAKE_OUT_OF_RANGE",
      `El stake debe ser un entero entre ${BET_MIN_SATS} y ${BET_MAX_SATS} sats`,
    );
  }
  const stakeMsat = satsToMsat(stakeSats);

  // Deadline de depósito: el del contrato acotado por la ventana del escrow (la
  // política de la casa manda si el retador pidió una ventana más larga).
  const now = Date.now();
  const contractDeadlineSec = Number(ev.tags.find((t) => t[0] === "deadline")?.[1]);
  const escrowCap = now + DEPOSIT_WINDOW_MS;
  let depositDeadlineMs = escrowCap;
  if (Number.isFinite(contractDeadlineSec) && contractDeadlineSec > 0) {
    const contractMs = contractDeadlineSec * 1000;
    if (contractMs <= now) return fail("CONTRACT_EXPIRED", "El contrato ya venció");
    depositDeadlineMs = Math.min(contractMs, escrowCap);
  }

  // Comisiones resueltas server-side, igual que createZapBet: el retador acepta
  // las condiciones publicadas del escrow al usar esta tienda (no las negocia).
  const economy = await getEconomySettings();
  const { feePct, devFeePct } = resolveBetFees({
    game: { betFeePct: game.betFeePct, betDevFeePct: game.betDevFeePct },
    provider: { betDevFeePct: game.provider.betDevFeePct },
    economy,
  });

  const victoryCondition = (ev.content ?? "").slice(0, 500);
  const roomId = ev.tags.find((t) => t[0] === "room")?.[1] ?? null;

  // ANCLA: el POST HUMANO raíz (kind:1) del que cuelga este contrato como
  // comentario (`e` root), si existe. Así los depósitos, el estado (31340), los
  // comentarios de participación y el premio anclan a una nota LEGIBLE en
  // cualquier cliente Nostr (Jumble, Damus…) en vez de al kind:1339 que no
  // rinden. Si el 1339 no referencia un root (P2P puro), el ancla es él mismo.
  const rootRef =
    ev.tags.find((t) => t[0] === "e" && t[3] === "root")?.[1] ??
    ev.tags.find((t) => t[0] === "e")?.[1];
  const anchorEventId = rootRef ?? contractEventId;
  if (anchorEventId !== contractEventId) {
    const alreadyByRoot = await prisma.zapBet.findUnique({
      where: { anchorEventId },
      select: { id: true, gameId: true },
    });
    if (alreadyByRoot) {
      return { ok: true, betId: alreadyByRoot.id, gameId: alreadyByRoot.gameId };
    }
  }

  // Resolver cada participante a un User (cuenta existente o mínima por pubkey).
  // Los pubkeys son válidos: vinieron de un evento firmado y verificado.
  const seats: { userId: string; npub: string; pubkey: string }[] = [];
  for (const pk of participantPubkeys) {
    const npub = nip19.npubEncode(pk);
    const user = await prisma.user.upsert({
      where: { pubkey: pk },
      update: {},
      create: { pubkey: pk, npub },
      select: { id: true },
    });
    seats.push({ userId: user.id, npub, pubkey: pk });
  }

  // Crear la apuesta con anchorEventId = id del 1339 (firmado por el RETADOR, no
  // por Luna). El `@unique` de anchorEventId serializa materializaciones
  // concurrentes: si otro depósito ganó la carrera, P2002 → re-leemos.
  let betId: string;
  try {
    const bet = await prisma.zapBet.create({
      data: {
        gameId: game.id,
        providerId: game.providerId,
        status: "pending_deposits",
        stakeMsat,
        feePct,
        devFeePct,
        victoryCondition,
        roomId,
        anchorEventId,
        // `K` del comentario de participación (NIP-22): si el 1339 cuelga de un post
        // humano raíz, el ancla es ese kind:1; si es P2P puro, el ancla es el 1339.
        anchorEventKind: rootRef ? 1 : 1339,
        // Firmante del contrato (retador): autoriza el void pre-fondeo por 1341.
        contractPubkey: ev.pubkey,
        // Oráculo declarado en el 1339 (TOFU): valida el 1341 de esta apuesta.
        oraclePubkey: oraclePk,
        depositDeadline: new Date(depositDeadlineMs),
        participants: {
          create: seats.map((s) => ({ userId: s.userId, npub: s.npub, pubkey: s.pubkey })),
        },
      },
      select: { id: true },
    });
    betId = bet.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await prisma.zapBet.findUnique({
        where: { anchorEventId },
        select: { id: true, gameId: true },
      });
      if (raced) return { ok: true, betId: raced.id, gameId: raced.gameId };
    }
    throw e;
  }

  // Hash interno de los términos (guard CONTRACT_MISMATCH del settle). Es
  // independiente del id del 1339: aquel ancla contra manipulación en relays,
  // este contra manipulación de la fila en la DB. Mismos campos que v2.
  const contractHash = computeContractHash({
    betId,
    gameId: game.id,
    stakeMsat,
    feePct,
    devFeePct,
    victoryCondition,
    npubs: seats.map((s) => s.npub),
  });
  await prisma.zapBet.update({ where: { id: betId }, data: { contractHash } });

  // Estado NGP `accepted` (fire-and-forget): el 31340 queda observable enseguida.
  void publishNgpBetState(betId);

  return { ok: true, betId, gameId: game.id };
}
