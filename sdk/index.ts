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
};

export type Bet = {
  betId: string;
  contractEventId: string | null;
  depositDeadline: string;
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
  /** Construye el evento (sin firmar) del resultado; firmalo con tu clave Nostr. */
  buildResultEvent(betId: string, winnerNpubs: string[]): UnsignedEvent;
  /** Reporta el resultado posteando el evento firmado por el proveedor. */
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
