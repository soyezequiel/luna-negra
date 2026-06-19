import { createHash } from "node:crypto";
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
  roomId?: unknown;
  metadata?: unknown;
};

export type CreateBetValid = {
  ok: true;
  gameId: string;
  npubs: string[];
  pubkeys: string[];
  stakeMsat: bigint;
  victoryCondition: string;
  roomId: string | null;
  /** Metadata libre serializada como JSON (o null). */
  metadataJson: string | null;
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

  if (body.roomId !== undefined && typeof body.roomId !== "string") {
    return err("INVALID_ROOM_ID", "roomId debe ser un string");
  }
  let metadataJson: string | null = null;
  if (body.metadata !== undefined && body.metadata !== null) {
    if (typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      return err("INVALID_METADATA", "metadata debe ser un objeto");
    }
    metadataJson = JSON.stringify(body.metadata);
  }

  return {
    ok: true,
    gameId: body.gameId,
    npubs,
    pubkeys,
    stakeMsat: satsToMsat(stake),
    victoryCondition:
      typeof body.victoryCondition === "string" ? body.victoryCondition : "",
    roomId: typeof body.roomId === "string" ? body.roomId : null,
    metadataJson,
  };
}

/**
 * Huella canónica de los términos económicos de la apuesta (stake, fee,
 * participantes, condición). Se embebe como tag ["terms", hash] en el evento
 * Nostr firmado (inmutable) y se guarda en el Bet. Antes de pagar se recalcula
 * desde el registro vivo y se compara: si difiere, los términos fueron alterados
 * después de firmar el contrato y NO se paga.
 *
 * Determinista: los npubs se ordenan (el orden de participantes no importa).
 */
export function computeContractHash(p: {
  betId: string;
  gameId: string;
  stakeMsat: bigint;
  feePct: number;
  victoryCondition: string;
  npubs: string[];
}): string {
  const canonical = JSON.stringify({
    betId: p.betId,
    gameId: p.gameId,
    stakeMsat: p.stakeMsat.toString(),
    feePct: p.feePct,
    victoryCondition: p.victoryCondition,
    npubs: [...p.npubs].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Plantilla (sin firmar) del evento de resultado de una apuesta. Misma forma
 * que produce el SDK (`buildResultEvent`): kind 30078, tags `t`/`bet`/`winner`.
 * Determinista salvo `created_at`. La firma la pone el proveedor (self-sign) o
 * Luna Negra con el oráculo gestionado.
 */
export function buildResultEventTemplate(p: {
  betId: string;
  winnerNpubs: string[];
  createdAt?: number;
}): { kind: number; created_at: number; tags: string[][]; content: string } {
  return {
    kind: 30078,
    created_at: p.createdAt ?? Math.floor(Date.now() / 1000),
    tags: [
      ["t", "lunanegra:result"],
      ["bet", p.betId],
      ...p.winnerNpubs.map((n) => ["winner", n]),
    ],
    content: "",
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
  /** Comisión mínima absoluta en sats (piso anti-routing). 0/omitido = sin piso. */
  feeMinSats?: number;
  providerName: string;
}): string {
  const comision = p.feeMinSats
    ? `${p.feePct}% (mínimo ${p.feeMinSats} sats)`
    : `${p.feePct}%`;
  return [
    `🌑 Contrato de apuesta — Luna Negra`,
    ``,
    `Juego: ${p.gameTitle}`,
    `Participantes: ${p.npubs.join(", ")}`,
    `Monto por jugador: ${p.stakeSats} sats`,
    `Gana: ${p.victoryCondition || "según el juego"} — el ganador se lleva el pozo menos ${comision} de comisión (empate = se divide).`,
    `Plazos: depósito 10 min · resolución 15 min.`,
    `Si no se completan los depósitos en 10 min, se reembolsa. Si no hay resultado en 15 min, se reembolsa todo.`,
    `Resuelve: ${p.providerName}.`,
    `ID: ${p.betId}`,
  ].join("\n");
}
