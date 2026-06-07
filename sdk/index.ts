// SDK oficial de Luna Negra para game servers.
// Valida OFFLINE los tokens de acceso (entitlement) e invitación (sala) usando
// la clave pública del JWKS — sin llamar a Luna Negra en cada request.
//
// Requiere `jose` (peer dependency):  npm i jose
import { jwtVerify, createRemoteJWKSet } from "jose";
import { createHmac, timingSafeEqual } from "node:crypto";

const AUDIENCE = "lunanegra:game";

/**
 * Verifica la firma de un webhook entrante (cabecera `X-LunaNegra-Signature`)
 * usando el secreto del proveedor. `rawBody` es el cuerpo crudo (sin parsear).
 */
export function verifyWebhook(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export type LunaNegraOptions = {
  /** Base URL de Luna Negra, ej. "https://luna-negra-three.vercel.app" */
  baseUrl: string;
  /** Issuer esperado (claim `iss`). Default: "luna-negra". */
  issuer?: string;
  /** API key del proveedor (`ln_sk_…`), necesaria para crear apuestas. */
  apiKey?: string;
};

export type CreateBetInput = {
  gameId: string;
  /** npubs de los participantes (mínimo 2). */
  participants: string[];
  /** Monto por jugador, en sats. */
  stakeSats: number;
  victoryCondition?: string;
  /** Sala multijugador del juego (correlación, opcional). */
  roomId?: string;
  /** Metadata libre (objeto). Se persiste y vuelve en GET y en cada webhook. */
  metadata?: Record<string, unknown>;
};

/** Economía de una apuesta (presente en createBet y getBet). */
export type BetEconomics = {
  stakeSats: number;
  /** Pozo total cuando esté completo (stake × participantes). */
  potTargetSats: number;
  feePct: number;
  /** Comisión en basis points (feePct × 100). */
  feeBps: number;
  /** Comisión absoluta, en sats. */
  feeSats: number;
  /** Pago neto a repartir entre ganadores (pozo − comisión), en sats. */
  netPayoutSats: number;
};

export type Bet = BetEconomics & {
  betId: string;
  contractEventId: string | null;
  depositDeadline: string;
  roomId: string | null;
  metadata: Record<string, unknown> | null;
};

/** Estado público de una apuesta. */
export type BetStatus =
  | "pending_deposits"
  | "funded"
  | "settled"
  | "cancelled"
  | "expired"
  | "refunded";

export type BetParticipantView = {
  npub: string;
  depositStatus: "pending" | "paid" | "refunded" | "failed";
  result: "pending" | "won" | "lost" | "tie";
  payoutStatus: string;
  payoutSats: number | null;
};

export type BetDetail = BetEconomics & {
  betId: string;
  gameId: string;
  status: BetStatus;
  victoryCondition: string;
  depositDeadline: string | null;
  resolveDeadline: string | null;
  /** Pozo depositado hasta ahora, en sats. */
  potSats: number;
  participants: BetParticipantView[];
  roomId: string | null;
  metadata: Record<string, unknown> | null;
  contractEventId: string | null;
  resultEventId: string | null;
};

/** Handle de pago de un participante (cómo deposita su stake en escrow). */
export type DepositHandle = {
  npub: string;
  depositStatus: "pending" | "paid" | "refunded" | "failed";
  /** Invoice Lightning fijo (BOLT11) por el stake. `null` si el depósito cerró. */
  bolt11: string | null;
  /** LNURL-pay (bech32) equivalente al invoice. `null` si cerró. */
  lnurl: string | null;
  /** Deep-link a la pantalla de pago de Luna Negra. `null` si cerró. */
  payUrl: string | null;
};

export type BetDeposits = {
  betId: string;
  status: BetStatus;
  stakeSats: number;
  potSats: number;
  potTargetSats: number;
  depositsReceived: number;
  depositsTotal: number;
  /** Plazo para completar los depósitos; si vence, se reembolsa y se cancela. */
  depositDeadline: string | null;
  deposits: DepositHandle[];
};

/** Plantilla de evento Nostr SIN firmar (la firma el proveedor con su clave). */
export type UnsignedEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type Entitlement = { npub: string; gameId: string; slug: string };

/**
 * Identidad + contexto de un invitado a una sala multijugador.
 *
 * `npub`/`pubkey` son la identidad Nostr ESTABLE del jugador: usalos como
 * `playerId`, nunca generes un UUID local. `displayName`/`avatarUrl` son solo
 * presentación (pueden ser null). `host: true` marca al creador de la sala;
 * `hostNpub`/`hostPubkey` identifican al host original para que los invitados
 * sepan quién es. `expiresAt` (ISO 8601) es cuándo caduca la invitación.
 *
 * Nota: `verifyRoom` valida el token OFFLINE, así que `displayName`/`avatarUrl`
 * vienen null (no van en el token). Para obtenerlos usá `getPlayerProfile(npub)`
 * o `GET /api/v1/rooms/verify` (que sí consulta el cache de perfiles).
 */
export type RoomInvite = {
  npub: string;
  pubkey: string;
  displayName: string | null;
  avatarUrl: string | null;
  gameId: string;
  slug: string;
  roomId: string;
  host: boolean;
  hostNpub: string | null;
  hostPubkey: string | null;
  expiresAt: string | null;
};

export type PlayerProfile = {
  npub: string;
  pubkey: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type LunaNegraClient = {
  /** Valida un token de acceso. Devuelve el entitlement o `null` si no es válido. */
  verifyAccess(token: string): Promise<Entitlement | null>;
  /** Valida un invite token de sala. Devuelve la info o `null`. */
  verifyRoom(token: string): Promise<RoomInvite | null>;
  /** Refresca nombre/avatar de un jugador por npub (sin depender del token). */
  getPlayerProfile(npub: string): Promise<PlayerProfile | null>;
  /** Crea una apuesta (requiere `apiKey`). */
  createBet(input: CreateBetInput): Promise<Bet>;
  /** Estado + economía de una apuesta (requiere `apiKey`). */
  getBet(betId: string): Promise<BetDetail>;
  /** Handles de pago por participante: bolt11 / lnurl / deep-link (requiere `apiKey`). */
  getBetDeposits(betId: string): Promise<BetDeposits>;
  /** Cancela una apuesta no resuelta y reembolsa depósitos (requiere `apiKey`). */
  cancelBet(betId: string): Promise<{ ok: boolean; status: string }>;
  /**
   * Reporta los ganadores usando SOLO la API key (recomendado): Luna Negra firma
   * el resultado con tu oráculo gestionado, no necesitás tocar Nostr.
   * `winnerNpubs` vacío = empate/anulación → reembolso total.
   */
  reportWinners(
    betId: string,
    winnerNpubs: string[],
  ): Promise<{ ok: boolean; voided?: boolean }>;
  /** Publica una nota en el feed de Actividad del juego (API key; Luna Negra firma). */
  postActivity(
    slug: string,
    content: string,
  ): Promise<{ ok: boolean; eventId: string; pubkey: string }>;
  /** [Avanzado] Construye el evento (sin firmar) del resultado; firmalo con tu clave de oráculo. */
  buildResultEvent(betId: string, winnerNpubs: string[]): UnsignedEvent;
  /** [Avanzado] Reporta el resultado posteando el evento firmado por tu oráculo. */
  reportResult(betId: string, signedEvent: unknown): Promise<boolean>;
};

export function createClient(opts: LunaNegraOptions): LunaNegraClient {
  const issuer = opts.issuer ?? "luna-negra";
  const base = opts.baseUrl.replace(/\/+$/, "");
  const jwks = createRemoteJWKSet(new URL(base + "/.well-known/jwks.json"));

  async function verify(token: string) {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: AUDIENCE,
    });
    return payload;
  }

  return {
    async verifyAccess(token) {
      try {
        const p = await verify(token);
        if (p.scope !== "entitlement") return null;
        return {
          npub: p.npub as string,
          gameId: p.gameId as string,
          slug: p.slug as string,
        };
      } catch {
        return null;
      }
    },
    async verifyRoom(token) {
      try {
        const p = await verify(token);
        if (p.scope !== "invite") return null;
        return {
          npub: p.npub as string,
          pubkey: p.pubkey as string,
          // No viajan en el token; usá getPlayerProfile() para poblarlos.
          displayName: null,
          avatarUrl: null,
          gameId: p.gameId as string,
          slug: p.slug as string,
          roomId: p.roomId as string,
          host: Boolean(p.host),
          hostNpub: (p.hostNpub as string | undefined) ?? null,
          hostPubkey: (p.hostPubkey as string | undefined) ?? null,
          expiresAt:
            typeof p.exp === "number"
              ? new Date(p.exp * 1000).toISOString()
              : null,
        };
      } catch {
        return null;
      }
    },

    async getPlayerProfile(npub) {
      try {
        const r = await fetch(
          base + "/api/v1/players/" + encodeURIComponent(npub) + "/profile",
        );
        if (!r.ok) return null;
        return (await r.json()) as PlayerProfile;
      } catch {
        return null;
      }
    },

    async createBet(input) {
      if (!opts.apiKey) throw new Error("createBet requiere `apiKey`");
      const r = await fetch(base + "/api/v1/bets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + opts.apiKey,
        },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "No se pudo crear la apuesta");
      return d as Bet;
    },

    async getBet(betId) {
      if (!opts.apiKey) throw new Error("getBet requiere `apiKey`");
      const r = await fetch(
        base + "/api/v1/bets/" + encodeURIComponent(betId),
        { headers: { authorization: "Bearer " + opts.apiKey } },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "No se pudo leer la apuesta");
      return d as BetDetail;
    },

    async getBetDeposits(betId) {
      if (!opts.apiKey) throw new Error("getBetDeposits requiere `apiKey`");
      const r = await fetch(
        base + "/api/v1/bets/" + encodeURIComponent(betId) + "/deposits",
        { headers: { authorization: "Bearer " + opts.apiKey } },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "No se pudieron leer los depósitos");
      return d as BetDeposits;
    },

    async cancelBet(betId) {
      if (!opts.apiKey) throw new Error("cancelBet requiere `apiKey`");
      const r = await fetch(
        base + "/api/v1/bets/" + encodeURIComponent(betId) + "/cancel",
        { method: "POST", headers: { authorization: "Bearer " + opts.apiKey } },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "No se pudo cancelar la apuesta");
      return d as { ok: boolean; status: string };
    },

    async reportWinners(betId, winnerNpubs) {
      if (!opts.apiKey) throw new Error("reportWinners requiere `apiKey`");
      const r = await fetch(
        base + "/api/v1/bets/" + encodeURIComponent(betId) + "/result",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + opts.apiKey,
          },
          body: JSON.stringify({ winners: winnerNpubs }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "No se pudo reportar el resultado");
      return d as { ok: boolean; voided?: boolean };
    },

    async postActivity(slug, content) {
      if (!opts.apiKey) throw new Error("postActivity requiere `apiKey`");
      const r = await fetch(
        base + "/api/v1/games/" + encodeURIComponent(slug) + "/activity",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + opts.apiKey,
          },
          body: JSON.stringify({ content }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "No se pudo publicar la actividad");
      return d as { ok: boolean; eventId: string; pubkey: string };
    },

    buildResultEvent(betId, winnerNpubs) {
      return {
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["t", "lunanegra:result"],
          ["bet", betId],
          ...winnerNpubs.map((n) => ["winner", n]),
        ],
        content: "",
      };
    },

    async reportResult(betId, signedEvent) {
      const r = await fetch(
        base + "/api/v1/bets/" + encodeURIComponent(betId) + "/result",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event: signedEvent }),
        },
      );
      return r.ok;
    },
  };
}
