// Push NGE (spec §9, v1.1): notification kind:24942 `bet_updated`.
//
// En cada transición observable de una apuesta NGE (depósito acreditado,
// funded, settled, expired, refunded, cancelled) el escrow publica un evento
// efímero firmado por la tienda y cifrado NIP-44 hacia la credencial `C` del
// juego. Es best-effort y NO autoritativo: despierta al cliente, que confirma
// con get_bet. Los call sites lo disparan fire-and-forget junto a la sombra
// NGP (publishNgpBetState) — a diferencia de ella, el push sale TAMBIÉN para
// apuestas unlisted (es canal privado, no liquidación pública).

import { finalizeEvent, type Event } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools";
import { notificationTemplate, type NgeNotificationPayload } from "../../sdk/nge";
import { prisma } from "@/lib/prisma";
import { RELAYS } from "@/lib/constants";
import { getStoreSecretKey } from "@/lib/nostr-server";
import { ngeStatusOf } from "@/lib/bet-status-public";
import { ngeMetaOf } from "@/lib/nge-meta";

// Pool compartido del canal NGE (suscripción del servicio + pushes). En
// globalThis por el patrón [[turbopack-estado-duplicado-globalthis]].
declare global {
  // eslint-disable-next-line no-var
  var lunaNgePool: SimplePool | undefined;
}

export function ngePool(): SimplePool {
  return (globalThis.lunaNgePool ??= new SimplePool());
}

/**
 * Publica resolviendo al PRIMER relay que acepta; el resto sigue en background.
 * Con que uno acepte, el mensaje viaja — esperar `allSettled` de 5 relays hace
 * que el más lento mande la latencia. Devuelve false si NINGUNO aceptó.
 */
export function publishFirstAck(pool: SimplePool, relays: string[], ev: Event): Promise<boolean> {
  const pubs = pool.publish(relays, ev).map((p) => p.then(() => true, () => false));
  return new Promise<boolean>((resolve) => {
    let pending = pubs.length;
    if (pending === 0) return resolve(false);
    for (const p of pubs) {
      void p.then((okd) => {
        if (okd) resolve(true);
        if (--pending === 0) resolve(false);
      });
    }
  });
}

/**
 * Push `bet_updated` para la apuesta (si es NGE y su juego tiene credencial).
 * Nunca lanza; los errores solo se loguean — el push jamás bloquea al motor.
 */
export async function notifyNgeBetUpdated(betId: string): Promise<void> {
  try {
    const sk = getStoreSecretKey();
    if (!sk) return;
    const bet = await prisma.zapBet.findUnique({
      where: { id: betId },
      include: { participants: { orderBy: { createdAt: "asc" } } },
    });
    if (!bet) return;
    const meta = ngeMetaOf(bet, bet.participants);
    if (!meta) return; // no es una apuesta NGE
    const cred = await prisma.ngeCredential.findUnique({ where: { gameId: bet.gameId } });
    if (!cred) return;

    const byNpub = new Map(bet.participants.map((p) => [p.npub, p]));
    const deposited = meta.seats
      .filter((s) => byNpub.get(s.npub)?.depositStatus === "paid")
      .map((s) => s.seatId);
    const payload: NgeNotificationPayload = {
      notification_type: "bet_updated",
      notification: { betId: bet.id, status: ngeStatusOf(bet), deposited },
    };
    const ev = finalizeEvent(
      notificationTemplate(payload, { clientPubkey: cred.servicePubkey, secretKey: sk }),
      sk,
    );
    await publishFirstAck(ngePool(), RELAYS, ev);
  } catch (err) {
    console.warn(`[nge] push bet_updated falló para ${betId}:`, err);
  }
}
