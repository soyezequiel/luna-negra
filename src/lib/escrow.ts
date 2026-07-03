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
  // Apuesta anónima (sin cuentas): el proveedor pide N asientos en vez de pasar
  // npubs. Luna Negra genera una identidad efímera por asiento.
  anonymous?: unknown;
  seats?: unknown;
};

/**
 * Especificación de un asiento de la apuesta, EN ORDEN (asiento 1..N). Un asiento
 * puede ser un npub real (jugador con cuenta) o un invitado efímero que el route
 * genera al crear la apuesta. Permite pozos MIXTOS: algunos participantes con
 * cuenta (cobran a su billetera) y otros invitados (cobran por LNURL-withdraw).
 */
export type SeatSpec =
  | { kind: "npub"; npub: string; pubkey: string }
  | { kind: "guest" };

export type CreateBetValid = {
  ok: true;
  gameId: string;
  /**
   * Apuesta anónima: el proveedor no pasó npubs, sino la cantidad de asientos.
   * En ese caso `npubs`/`pubkeys` vienen vacíos y el route genera una identidad
   * efímera por asiento. `seatCount` es la cantidad de jugadores.
   */
  anonymous: boolean;
  seatCount: number;
  npubs: string[];
  pubkeys: string[];
  /**
   * Asientos en orden. El route construye los participantes recorriendo esta
   * lista: minteando un invitado por cada `{ kind: "guest" }` y buscando el User
   * por pubkey para cada `{ kind: "npub" }`. `hasGuests` resume si hay ≥1 guest
   * (sirve para devolver el mapeo seat→npub al proveedor).
   */
  seatSpecs: SeatSpec[];
  hasGuests: boolean;
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
  cfg: { minSats: number; maxSats: number; maxSeats?: number },
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

  // Apuesta anónima: el proveedor pide N asientos en vez de pasar npubs. Las
  // identidades efímeras las genera el route (acá solo validamos la cantidad).
  // Apuesta normal/mixta: el proveedor pasa `participants`, donde cada entrada es
  // un npub (jugador con cuenta) o un placeholder `{ guest: true }` (invitado).
  const anonymous = body.anonymous === true;
  const maxSeats = cfg.maxSeats ?? 8;
  const npubs: string[] = [];
  const pubkeys: string[] = [];
  const seatSpecs: SeatSpec[] = [];
  let seatCount: number;
  if (anonymous) {
    seatCount = Number(body.seats);
    if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > maxSeats) {
      return err(
        "INVALID_SEATS",
        `Una apuesta anónima necesita entre 2 y ${maxSeats} asientos`,
      );
    }
    for (let i = 0; i < seatCount; i++) seatSpecs.push({ kind: "guest" });
  } else {
    if (!Array.isArray(body.participants) || body.participants.length < 2) {
      return err("INVALID_PARTICIPANTS", "Se necesitan al menos 2 participantes");
    }
    if (body.participants.length > maxSeats) {
      return err("INVALID_PARTICIPANTS", `Como máximo ${maxSeats} participantes`);
    }
    for (const entry of body.participants) {
      // Placeholder de invitado: el route mintea una identidad efímera por cada uno.
      if (entry && typeof entry === "object" && (entry as { guest?: unknown }).guest === true) {
        seatSpecs.push({ kind: "guest" });
        continue;
      }
      if (typeof entry !== "string") return err("INVALID_NPUB", "npub inválido");
      const pk = pubkeyFromNpub(entry);
      if (!pk) return err("INVALID_NPUB", `npub inválido: ${entry}`);
      npubs.push(entry);
      pubkeys.push(pk);
      seatSpecs.push({ kind: "npub", npub: entry, pubkey: pk });
    }
    // Solo los npubs reales pueden colisionar; los invitados son siempre únicos.
    if (new Set(pubkeys).size !== pubkeys.length) {
      return err("DUPLICATE_PARTICIPANT", "Hay participantes duplicados");
    }
    seatCount = seatSpecs.length;
  }
  const hasGuests = seatSpecs.some((s) => s.kind === "guest");

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
    anonymous,
    seatCount,
    npubs,
    pubkeys,
    seatSpecs,
    hasGuests,
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
  /** Corte del dev. Solo entra al canónico si es > 0, para no romper el hash de
   *  apuestas previas a la feature (devFeePct 0 hashea idéntico a antes). */
  devFeePct?: number;
  victoryCondition: string;
  npubs: string[];
}): string {
  const canonical = JSON.stringify({
    betId: p.betId,
    gameId: p.gameId,
    stakeMsat: p.stakeMsat.toString(),
    feePct: p.feePct,
    ...(p.devFeePct && p.devFeePct > 0 ? { devFeePct: p.devFeePct } : {}),
    victoryCondition: p.victoryCondition,
    npubs: [...p.npubs].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Plantilla (sin firmar) del evento de resultado de una apuesta. Misma forma
 * que produce el SDK (`buildResultEvent`): kind 30078, tags `d`/`t`/`bet`/`winner`.
 * Determinista salvo `created_at`. La firma la pone el proveedor (self-sign) o
 * Luna Negra con el oráculo gestionado.
 *
 * El tag `d` = betId es obligatorio: kind:30078 es un evento DIRECCIONABLE
 * (NIP-01, rango 30000–39999). Sin `d`, todos los resultados del mismo firmante
 * comparten la coordenada `30078:<pubkey>:""` y se pisan entre sí en los relays
 * (queda sólo el último) y quedan mal formados → indexadores como el de njump no
 * los levantan. Con `d`=betId cada resultado es una coordenada única y estable.
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
      ["d", p.betId],
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
  /** Corte del dev (proveedor) sobre el pozo. 0/omitido = el dev no cobra. */
  devFeePct?: number;
  /** Comisión mínima absoluta en sats (piso anti-routing). 0/omitido = sin piso. */
  feeMinSats?: number;
  providerName: string;
}): string {
  const comisionCasa = p.feeMinSats
    ? `${p.feePct}% (mínimo ${p.feeMinSats} sats)`
    : `${p.feePct}%`;
  const comision =
    p.devFeePct && p.devFeePct > 0
      ? `${comisionCasa} de Luna Negra + ${p.devFeePct}% del desarrollador`
      : comisionCasa;
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
