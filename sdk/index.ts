// SDK oficial de Luna Negra para game servers.
// Valida OFFLINE los tokens de acceso (entitlement) e invitación (sala) usando
// la clave pública del JWKS — sin llamar a Luna Negra en cada request.
//
// Requiere `jose` (peer dependency):  npm i jose
import { jwtVerify, createRemoteJWKSet } from "jose";

const AUDIENCE = "lunanegra:game";

export type LunaNegraOptions = {
  /** Base URL de Luna Negra, ej. "https://luna-negra-three.vercel.app" */
  baseUrl: string;
  /** Issuer esperado (claim `iss`). Default: "luna-negra". */
  issuer?: string;
};

export type Entitlement = { npub: string; gameId: string; slug: string };

export type RoomInvite = {
  npub: string;
  gameId: string;
  slug: string;
  roomId: string;
  host: boolean;
};

export type LunaNegraClient = {
  /** Valida un token de acceso. Devuelve el entitlement o `null` si no es válido. */
  verifyAccess(token: string): Promise<Entitlement | null>;
  /** Valida un invite token de sala. Devuelve la info o `null`. */
  verifyRoom(token: string): Promise<RoomInvite | null>;
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
          gameId: p.gameId as string,
          slug: p.slug as string,
          roomId: p.roomId as string,
          host: Boolean(p.host),
        };
      } catch {
        return null;
      }
    },
  };
}
