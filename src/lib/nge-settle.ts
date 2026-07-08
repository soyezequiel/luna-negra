// Liquidación NGE con el oráculo GESTIONADO — compartida entre el camino
// inmediato (report_result sin ventana) y el diferido (ventana de disputa,
// spec §7.1: el tick ejecuta cuando vence settleAt). Firma el kind:1341 con la
// clave de oráculo custodiada del proveedor y despacha al motor v2.

import { prisma } from "@/lib/prisma";
import { ensureOracleKey, getOracleSecret } from "@/lib/oracle-keys";
import { signResultEventV2 } from "@/lib/nostr-server";
import { settleZapBetWithResult, type ZapBetWithRelations } from "@/lib/escrow-v2-settle";
import { notifyOperationalError } from "@/lib/discord";
import { notifyNgeBetUpdated } from "@/lib/nge-notify";

export type NgeSettleOutcome =
  | { ok: true; finalStatus?: string | null; voided?: boolean }
  | {
      ok: false;
      code: "ORACLE_KEY_ERROR" | "ORACLE_NOT_PROVISIONED" | "NOT_READY" | "INTERNAL";
      message: string;
    };

/**
 * Firma el resultado con el oráculo gestionado del proveedor y liquida.
 * `winnerNpubs` vacío = empate/anulación → reembolso. No valida BYO/self-signed:
 * eso lo hace el caller ANTES (report_result falla rápido con SELF_SIGNED_ORACLE;
 * una apuesta diferida ya pasó ese check al fijarse el resultado).
 */
export async function settleNgeWithManagedOracle(
  betId: string,
  winnerNpubs: string[],
): Promise<NgeSettleOutcome> {
  const bet = await prisma.zapBet.findUnique({
    where: { id: betId },
    include: {
      provider: { include: { owner: true } },
      participants: true,
      game: { select: { nostrCoord: true } },
    },
  });
  if (!bet) return { ok: false, code: "INTERNAL", message: "apuesta inexistente" };

  let sk: Uint8Array | null;
  try {
    sk = await getOracleSecret(bet.providerId);
    if (!sk) {
      await ensureOracleKey(bet.providerId);
      sk = await getOracleSecret(bet.providerId);
    }
  } catch (err) {
    console.error(`[nge] no se pudo acceder a la clave de oráculo de ${bet.providerId}:`, err);
    await notifyOperationalError({
      source: "nge-oracle-key",
      error: err,
      fingerprint: `nge-oracle-key:${bet.providerId}`,
      context: { betId: bet.id, providerId: bet.providerId },
    });
    return {
      ok: false,
      code: "ORACLE_KEY_ERROR",
      message:
        "no se pudo acceder a la clave de oráculo del proveedor (revisá ORACLE_ENC_KEY en el servidor)",
    };
  }
  if (!sk) {
    return {
      ok: false,
      code: "ORACLE_NOT_PROVISIONED",
      message: "el proveedor no tiene clave de oráculo gestionada; contactá soporte para provisionarla",
    };
  }

  const resultEvent = signResultEventV2(
    sk,
    bet.id,
    winnerNpubs,
    bet.anchorEventId,
    bet.game.nostrCoord,
  );
  const r = await settleZapBetWithResult({
    bet: bet as unknown as ZapBetWithRelations,
    winnerNpubs,
    resultEvent,
  });
  if (r.ok) return { ok: true, finalStatus: r.finalStatus, voided: r.voided };
  if (r.code === "NOT_READY") return { ok: false, code: "NOT_READY", message: r.message };
  return { ok: false, code: "INTERNAL", message: r.message };
}

/**
 * Ejecuta las liquidaciones diferidas vencidas (ventana de disputa, spec §7.1).
 * La llama el tick v2. Un fallo transitorio conserva `settleAt`: el próximo
 * tick reintenta. Nunca lanza.
 */
export async function runNgeDeferredSettlements(): Promise<void> {
  let due: { id: string; pendingWinnersJson: string | null }[] = [];
  try {
    due = await prisma.zapBet.findMany({
      where: {
        status: "ready",
        settleAt: { lte: new Date() },
        pendingWinnersJson: { not: null },
      },
      select: { id: true, pendingWinnersJson: true },
    });
  } catch {
    return;
  }
  for (const bet of due) {
    try {
      let winners: string[];
      try {
        const parsed = JSON.parse(bet.pendingWinnersJson ?? "[]");
        winners = Array.isArray(parsed) ? parsed.filter((w) => typeof w === "string") : [];
      } catch {
        winners = [];
      }
      const r = await settleNgeWithManagedOracle(bet.id, winners);
      if (r.ok) {
        void notifyNgeBetUpdated(bet.id);
      } else {
        console.warn(`[nge] liquidación diferida de ${bet.id} falló (${r.code}): ${r.message}`);
        await notifyOperationalError({
          source: "nge-deferred-settle",
          error: new Error(`${r.code}: ${r.message}`),
          fingerprint: `nge-deferred-settle:${bet.id}`,
          cooldownMs: 60 * 60_000,
          context: { betId: bet.id },
        });
      }
    } catch (err) {
      console.error(`[nge] liquidación diferida de ${bet.id} lanzó:`, err);
    }
  }
}
