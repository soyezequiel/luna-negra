import { nip19 } from "nostr-tools";
import { satsToMsat } from "./money";

export function pubkeyFromNpub(npub: string): string | null {
  try {
    const d = nip19.decode(npub.trim());
    return d.type === "npub" ? (d.data as string) : null;
  } catch {
    return null;
  }
}

export type CreateBetBody = {
  gameId?: unknown;
  participants?: unknown;
  stakeSats?: unknown;
  victoryCondition?: unknown;
};

export type CreateBetValid = {
  ok: true;
  gameId: string;
  npubs: string[];
  pubkeys: string[];
  stakeMsat: bigint;
  victoryCondition: string;
};
export type CreateBetError = { ok: false; code: string; error: string };

/** Validación PURA del request de crear apuesta (testeable sin DB). */
export function validateCreateBet(
  body: CreateBetBody,
  cfg: { minSats: number; maxSats: number },
): CreateBetValid | CreateBetError {
  const err = (code: string, error: string): CreateBetError => ({
    ok: false,
    code,
    error,
  });

  if (typeof body.gameId !== "string" || !body.gameId) {
    return err("MISSING_GAME", "Falta gameId");
  }
  const stake = Number(body.stakeSats);
  if (!Number.isInteger(stake) || stake < cfg.minSats || stake > cfg.maxSats) {
    return err(
      "STAKE_OUT_OF_RANGE",
      `El monto debe ser un entero entre ${cfg.minSats} y ${cfg.maxSats} sats`,
    );
  }
  if (!Array.isArray(body.participants) || body.participants.length < 2) {
    return err("INVALID_PARTICIPANTS", "Se necesitan al menos 2 participantes");
  }
  const npubs: string[] = [];
  const pubkeys: string[] = [];
  for (const np of body.participants) {
    if (typeof np !== "string") return err("INVALID_NPUB", "npub inválido");
    const pk = pubkeyFromNpub(np);
    if (!pk) return err("INVALID_NPUB", `npub inválido: ${np}`);
    npubs.push(np);
    pubkeys.push(pk);
  }
  if (new Set(pubkeys).size !== pubkeys.length) {
    return err("DUPLICATE_PARTICIPANT", "Hay participantes duplicados");
  }

  return {
    ok: true,
    gameId: body.gameId,
    npubs,
    pubkeys,
    stakeMsat: satsToMsat(stake),
    victoryCondition:
      typeof body.victoryCondition === "string" ? body.victoryCondition : "",
  };
}

/** Texto legible por humanos del contrato (se publica en Nostr). */
export function buildContractText(p: {
  betId: string;
  gameTitle: string;
  npubs: string[];
  stakeSats: number;
  victoryCondition: string;
  feePct: number;
  providerName: string;
}): string {
  return [
    `🌑 Contrato de apuesta — Luna Negra`,
    ``,
    `Juego: ${p.gameTitle}`,
    `Participantes: ${p.npubs.join(", ")}`,
    `Monto por jugador: ${p.stakeSats} sats`,
    `Gana: ${p.victoryCondition || "según el juego"} — el ganador se lleva el pozo menos ${p.feePct}% de comisión (empate = se divide).`,
    `Plazos: depósito 10 min · resolución 15 min.`,
    `Si no se completan los depósitos en 10 min, se reembolsa. Si no hay resultado en 15 min, se reembolsa todo.`,
    `Resuelve: ${p.providerName}.`,
    `ID: ${p.betId}`,
  ].join("\n");
}
