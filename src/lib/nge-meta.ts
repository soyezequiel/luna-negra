// Metadata NGE de una apuesta v2 — punto ÚNICO de acceso.
//
// Las apuestas NGE nuevas guardan su mapeo en columnas reales (v1.1):
// `ZapBetParticipant.ngeSeatId` (asiento↔participante), `ZapBet.ngeClientRef`
// (idempotencia) y `ZapBet.ngeUnlisted` (visibility). Las filas viejas lo
// tienen en `ZapBet.metadataJson` bajo la clave `nge`: este módulo lee con
// fallback para no necesitar backfill. Nadie más parsea ese JSON.

import type { ZapBet, ZapBetParticipant } from "@prisma/client";

export type NgeSeatMeta = { seatId: string; npub: string; pubkey?: string };
export type NgeMeta = { seats: NgeSeatMeta[]; clientRef?: string; visibility?: "unlisted" };

type BetMetaFields = Pick<ZapBet, "metadataJson"> &
  Partial<Pick<ZapBet, "ngeClientRef" | "ngeUnlisted">>;
type SeatFields = Pick<ZapBetParticipant, "npub" | "pubkey"> &
  Partial<Pick<ZapBetParticipant, "ngeSeatId">>;

/** Parser del formato legacy (filas anteriores a las columnas). */
export function parseNgeMetaJson(metadataJson: string | null): NgeMeta | null {
  if (!metadataJson) return null;
  try {
    const meta = JSON.parse(metadataJson) as { nge?: NgeMeta };
    return meta?.nge && Array.isArray(meta.nge.seats) ? meta.nge : null;
  } catch {
    return null;
  }
}

/**
 * Metadata NGE de la apuesta (columnas primero, JSON legacy como fallback).
 * `null` = la apuesta no es de NGE. En filas nuevas el `pubkey` del asiento es
 * el del participante (los asientos identificados usan la cuenta real del
 * jugador, así que coincide con su pubkey real; los anónimos, la del invitado).
 */
export function ngeMetaOf(bet: BetMetaFields, participants: SeatFields[]): NgeMeta | null {
  const seatRows = participants.filter((p) => p.ngeSeatId);
  if (seatRows.length > 0) {
    return {
      seats: seatRows.map((p) => ({
        seatId: p.ngeSeatId as string,
        npub: p.npub,
        pubkey: p.pubkey,
      })),
      ...(bet.ngeClientRef ? { clientRef: bet.ngeClientRef } : {}),
      ...(bet.ngeUnlisted ? { visibility: "unlisted" as const } : {}),
    };
  }
  return parseNgeMetaJson(bet.metadataJson);
}

/**
 * ¿La apuesta pidió liquidación "unlisted"? (create_bet.visibility, spec §7).
 * Omite la sombra 31340 y la nota social de ESA apuesta; el contrato-ancla y
 * los recibos existen igual (son el riel del escrow).
 */
export function isUnlistedBet(
  bet: Pick<ZapBet, "metadataJson"> & Partial<Pick<ZapBet, "ngeUnlisted">>,
): boolean {
  if (bet.ngeUnlisted) return true;
  if (!bet.metadataJson) return false;
  try {
    const meta = JSON.parse(bet.metadataJson) as {
      nge?: { visibility?: string };
      visibility?: string;
    };
    return meta?.nge?.visibility === "unlisted" || meta?.visibility === "unlisted";
  } catch {
    return false;
  }
}

/**
 * Pubkey REAL del jugador de un asiento NGE legacy, leída del seatsMeta del
 * JSON por el npub del invitado. En el diseño viejo TODOS los asientos NGE se
 * envolvían en cuentas invitadas efímeras, y el payout debía saltar al jugador
 * real. En filas nuevas devuelve null y no hace falta: los asientos
 * identificados usan la cuenta real del jugador directamente.
 */
export function ngeSeatRealPubkey(
  bet: Pick<ZapBet, "metadataJson">,
  guestNpub: string,
): string | null {
  try {
    const meta = JSON.parse(bet.metadataJson ?? "{}") as {
      nge?: { seats?: Array<{ npub?: string; pubkey?: string }> };
    };
    const seat = meta.nge?.seats?.find((s) => s.npub === guestNpub);
    const pk = seat?.pubkey;
    return typeof pk === "string" && /^[0-9a-f]{64}$/.test(pk) ? pk : null;
  } catch {
    return null;
  }
}
